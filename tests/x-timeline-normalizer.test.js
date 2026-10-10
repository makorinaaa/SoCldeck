const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./fixtures/x-home-timeline.json');
const {
  buildSegments,
  normalizeTimelineResponse,
  normalizeUser,
  timelineOperation,
} = require('../src/main/x-timeline-normalizer');

test('recognizes only the captured GraphQL operations on X hosts', () => {
  assert.equal(timelineOperation('https://x.com/i/api/graphql/abc123/HomeTimeline?variables=%7B%7D'), 'HomeTimeline');
  assert.equal(timelineOperation('https://x.com/i/api/graphql/abc123/HomeLatestTimeline'), 'HomeLatestTimeline');
  assert.equal(timelineOperation('https://x.com/i/api/graphql/abc123/ListLatestTweetsTimeline'), 'ListLatestTweetsTimeline');
  assert.equal(timelineOperation('https://x.com/i/api/graphql/abc123/UserTweets'), null);
  assert.equal(timelineOperation('https://evil.example/i/api/graphql/abc123/HomeTimeline'), null);
  assert.equal(timelineOperation('not a url'), null);
});

test('normalizes tweets, reposts and conversation modules while dropping ads', () => {
  const timeline = normalizeTimelineResponse(fixture, 'HomeLatestTimeline');
  assert.equal(timeline.timeline, 'following');
  assert.deepEqual(timeline.cursors, { top: 'TOPCURSOR', bottom: 'BOTTOMCURSOR' });
  assert.deepEqual(timeline.posts.map(post => post.id), [
    '1800000000000000003',
    '1700000000000000001',
    '1800000000000000001',
  ]);

  const [first, repost, conversation] = timeline.posts;
  assert.deepEqual(first.author, {
    id: '11',
    handle: 'alice',
    name: 'Alice',
    avatar: 'https://pbs.twimg.com/profile_images/1/alice_bigger.jpg',
    verified: true,
    protected: false,
  });
  assert.equal(first.url, 'https://x.com/alice/status/1800000000000000003');
  assert.equal(first.createdAt, '2026-10-05T03:00:00.000Z');
  assert.deepEqual(first.counts, { reply: 3, repost: 5, like: 42, quote: 1, view: 12345 });
  assert.deepEqual(first.viewer, { liked: true, reposted: false });
  assert.equal(first.sortIndex, '1900000000000000003');
  assert.deepEqual(first.media.map(item => [item.type, item.url, item.alt]), [
    ['photo', 'https://pbs.twimg.com/media/AAA.jpg?name=large', 'a cat'],
    ['photo', 'https://pbs.twimg.com/media/BBB.jpg?name=large', ''],
  ]);

  assert.deepEqual(repost.repostedBy, { handle: 'carol', name: 'Carol' });
  assert.equal(repost.author.handle, 'dave');
  assert.equal(repost.counts.like, 100);
  assert.equal(repost.viewer.reposted, true);
  assert.equal(repost.sortIndex, '1900000000000000002');
  assert.equal(repost.media[0].type, 'video');
  assert.equal(repost.media[0].videoUrl, 'https://video.twimg.com/ext_tw_video/1/pu/vid/1280x720/mid.mp4');

  assert.equal(conversation.replyTo, 'erin');
  assert.deepEqual(conversation.segments, [
    { type: 'text', text: 'A long post that goes beyond the limit ' },
    { type: 'link', url: 'https://example.org/long', text: 'example.org/long' },
  ]);
  assert.equal(conversation.quoted.author.handle, 'frank');
  assert.deepEqual(conversation.quoted.segments, [{ type: 'text', text: 'quoted <b>text</b>' }]);
});

test('builds text segments by locating entities and removes media links', () => {
  const [first] = normalizeTimelineResponse(fixture).posts;
  assert.deepEqual(first.segments, [
    { type: 'text', text: 'Tom & Jerry with ' },
    { type: 'mention', handle: 'bob', text: '@bob' },
    { type: 'text', text: ' ' },
    { type: 'hashtag', tag: 'anime', text: '#anime' },
    { type: 'text', text: ' ' },
    { type: 'link', url: 'https://example.com/article', text: 'example.com/article' },
  ]);
});

test('keeps unsafe link targets as plain text', () => {
  assert.deepEqual(buildSegments('see https://t.co/x', {
    urls: [{ url: 'https://t.co/x', expanded_url: 'javascript:alert(1)', display_url: 'bad' }],
  }), [{ type: 'text', text: 'see https://t.co/x' }]);
});

test('returns null for responses that are not Home timelines', () => {
  assert.equal(normalizeTimelineResponse({ data: {} }), null);
  assert.equal(normalizeTimelineResponse(null), null);
});

test('normalizes the CreateTweet response so the new post can be shown at once', () => {
  const { normalizeCapturedResponse } = require('../src/main/x-timeline-normalizer');
  const tweet = fixture.data.home.home_timeline_urt.instructions[0].entries[0]
    .content.itemContent.tweet_results.result;
  assert.equal(timelineOperation('https://x.com/i/api/graphql/q/CreateTweet'), 'CreateTweet');
  const created = normalizeCapturedResponse({ data: { create_tweet: { tweet_results: { result: tweet } } } }, 'CreateTweet');
  assert.equal(created.operation, 'CreateTweet');
  assert.equal(created.timeline, null);
  assert.deepEqual(created.posts.map(post => post.id), ['1800000000000000003']);
  assert.equal(normalizeCapturedResponse({ data: {} }, 'CreateTweet'), null);
});

test('normalizes TweetDetail into ancestors, the focal post and reply chains', () => {
  const { normalizeCapturedResponse } = require('../src/main/x-timeline-normalizer');
  const entries = fixture.data.home.home_timeline_urt.instructions[0].entries;
  const tweetEntry = (entryId, index) => ({ ...entries[index], entryId });
  const detail = {
    data: {
      threaded_conversation_with_injections_v2: {
        instructions: [{
          type: 'TimelineAddEntries',
          entries: [
            tweetEntry('tweet-1800000000000000003', 0),
            tweetEntry('tweet-1800000000000000002', 1),
            entries[2],
            {
              entryId: 'conversationthread-1',
              content: {
                entryType: 'TimelineTimelineModule',
                items: entries[3].content.items,
              },
            },
          ],
        }],
      },
    },
  };
  const url = `https://x.com/i/api/graphql/q/TweetDetail?variables=${encodeURIComponent(JSON.stringify({ focalTweetId: '1700000000000000001' }))}`;
  const result = normalizeCapturedResponse(detail, 'TweetDetail', url);
  assert.equal(result.operation, 'TweetDetail');
  assert.equal(result.focalId, '1700000000000000001');
  assert.deepEqual(result.thread.map(post => post.id), ['1800000000000000003', '1700000000000000001']);
  assert.equal(result.thread[1].author.handle, 'dave');
  assert.deepEqual(result.replies.map(chain => [chain.post.id, chain.replies.length]), [['1800000000000000001', 0]]);
  // Without a focal id in the request URL the whole thread is returned for the renderer to pick from.
  assert.equal(normalizeCapturedResponse(detail, 'TweetDetail', 'https://x.com/i/api/graphql/q/TweetDetail').focalId, '');
  assert.equal(normalizeCapturedResponse(detail, 'TweetDetail', 'https://x.com/i/api/graphql/q/TweetDetail?variables=%7B%22focalTweetId%22%3A%229%22%7D'), null);
});

test('marks protected accounts from either the privacy or the legacy field', () => {
  const user = extra => ({ result: { rest_id: '1', core: { screen_name: 'locked' }, ...extra } });
  assert.equal(normalizeUser(user({ privacy: { protected: true } })).protected, true);
  assert.equal(normalizeUser(user({ legacy: { protected: true } })).protected, true);
  assert.equal(normalizeUser(user({ privacy: { protected: false }, legacy: { protected: true } })).protected, false);
  assert.equal(normalizeUser(user({})).protected, false);
});

test('keeps the replied-to user id for timeline filtering', () => {
  const [, , conversation] = normalizeTimelineResponse({
    data: { home: { home_timeline_urt: { instructions: [{
      type: 'TimelineAddEntries',
      entries: fixture.data.home.home_timeline_urt.instructions[0].entries.map(entry => JSON.parse(JSON.stringify(entry).replace('"in_reply_to_screen_name":"erin"', '"in_reply_to_screen_name":"frank","in_reply_to_user_id_str":"16"'))),
    }] } } },
  }).posts;
  assert.equal(conversation.replyTo, 'frank');
  assert.equal(conversation.replyToId, '16');
});

test('accepts any home timeline operation and labels only the known ones', () => {
  assert.equal(timelineOperation('https://x.com/i/api/graphql/q/HomeFollowingTimeline'), 'HomeFollowingTimeline');
  assert.equal(timelineOperation('https://x.com/i/api/graphql/q/UserTweets'), null);
  assert.equal(normalizeTimelineResponse(fixture, 'HomeFollowingTimeline').timeline, null);
  assert.equal(normalizeTimelineResponse(fixture, 'HomeLatestTimeline').timeline, 'following');
});

test('normalizes a list timeline like the Home timeline', () => {
  const json = { data: { list: { tweets_timeline: { timeline: { instructions: fixture.data.home.home_timeline_urt.instructions } } } } };
  const list = normalizeTimelineResponse(json, 'ListLatestTweetsTimeline');
  const home = normalizeTimelineResponse(fixture, 'HomeLatestTimeline');
  assert.equal(list.timeline, 'list');
  assert.deepEqual(list.posts.map(post => post.id), home.posts.map(post => post.id));
  assert.deepEqual(list.cursors, home.cursors);
});
