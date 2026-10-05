const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./fixtures/x-home-timeline.json');
const { normalizeCapturedResponse, timelineOperation } = require('../src/main/x-timeline-normalizer');
const { reasonFromIcon } = require('../src/main/x-notification-normalizer');

const plain = value => JSON.parse(JSON.stringify(value));

test('recognizes the notification requests of both X formats', () => {
  assert.equal(timelineOperation('https://x.com/i/api/2/notifications/all.json?count=40'), 'NotificationsRest');
  assert.equal(timelineOperation('https://x.com/i/api/2/notifications/mentions.json'), 'NotificationsRest');
  assert.equal(timelineOperation('https://x.com/i/api/graphql/abc/NotificationsTimeline'), 'NotificationsTimeline');
  assert.equal(timelineOperation('https://evil.example/i/api/2/notifications/all.json'), null);
});

test('reads the adaptive REST format with liked post ids and mentions', () => {
  const json = {
    globalObjects: {
      users: {
        1: { screen_name: 'shun', name: 'shun', profile_image_url_https: 'https://pbs.twimg.com/profile_images/1/s_normal.jpg' },
        2: { screen_name: 'me', name: 'Me' },
        3: { screen_name: 'bob', name: 'Bob' },
      },
      tweets: {
        9: { full_text: 'いい更新だ', user_id_str: '2' },
        10: { full_text: '@me hello', user_id_str: '3', in_reply_to_status_id_str: '9', created_at: 'Mon Oct 05 03:00:00 +0000 2026' },
      },
      notifications: {
        n1: {
          id: 'n1', icon: { id: 'heart_icon' }, timestampMs: '1790000000000',
          message: { text: 'shunさんがあなたのポストをいいねしました' },
          template: { aggregateUserActionsV1: { targetObjects: [{ tweet: { id: '9' } }], fromUsers: [{ user: { id: '1' } }] } },
        },
      },
    },
    timeline: { instructions: [{ addEntries: { entries: [
      { entryId: 'notification-n1', sortIndex: '5', content: { item: { content: { notification: { id: 'n1' } } } } },
      { entryId: 'notification-10', sortIndex: '6', content: { item: { content: { tweet: { id: '10' } } } } },
    ] } }] },
  };
  const result = normalizeCapturedResponse(json, 'NotificationsRest');
  assert.equal(result.operation, 'Notifications');
  const [reply, like] = result.notifications;
  assert.deepEqual(plain({ reason: like.reason, targetId: like.targetId, targetUrl: like.targetUrl, actorHandle: like.actorHandle, postText: like.postText }), {
    reason: 'like', targetId: '9', targetUrl: 'https://x.com/me/status/9', actorHandle: 'shun', postText: 'いい更新だ',
  });
  assert.equal(like.avatar, 'https://pbs.twimg.com/profile_images/1/s_bigger.jpg');
  assert.equal(reply.reason, 'reply');
  assert.equal(reply.targetUrl, 'https://x.com/bob/status/10');
  assert.equal(reply.postText, '@me hello');
});

test('reads the GraphQL format: aggregated actions and post notifications', () => {
  const tweet = fixture.data.home.home_timeline_urt.instructions[0].entries[0].content.itemContent.tweet_results.result;
  const json = {
    data: { viewer_v2: { user_results: { result: { notification_timeline: { timeline: { instructions: [{
      type: 'TimelineAddEntries',
      entries: [
        { entryId: 'notification-a', sortIndex: '9', content: { itemContent: {
          itemType: 'TimelineNotification', id: 'a', notification_icon: 'retweet_icon', timestamp_ms: '1790000000000',
          rich_message: { text: 'Bobさんがあなたのポストをリポストしました' },
          template: {
            target_objects: [{ tweet_results: { result: tweet } }],
            from_users: [{ user_results: { result: { rest_id: '3', core: { name: 'Bob', screen_name: 'bob' }, legacy: {} } } }],
          },
        } } },
        { entryId: 'notification-b', sortIndex: '8', content: { itemContent: { itemType: 'TimelineTweet', tweet_results: { result: tweet } } } },
      ],
    }] } } } } } },
  };
  const result = normalizeCapturedResponse(json, 'NotificationsTimeline');
  const repost = result.notifications.find(item => item.id === 'a');
  assert.equal(repost.reason, 'repost');
  assert.equal(repost.targetUrl, 'https://x.com/alice/status/1800000000000000003');
  assert.equal(repost.actorHandle, 'bob');
  assert.match(repost.text, /リポスト/);
  const mention = result.notifications.find(item => item.id !== 'a');
  assert.equal(mention.reason, 'mention');
  assert.equal(mention.targetId, '1800000000000000003');
});

test('unknown notification data yields nothing, so the page is read instead', () => {
  assert.equal(normalizeCapturedResponse({ data: { something: {} } }, 'NotificationsTimeline'), null);
  assert.equal(normalizeCapturedResponse({}, 'NotificationsRest'), null);
});

test('maps X notification icons and wording to reasons', () => {
  assert.equal(reasonFromIcon('heart_icon'), 'like');
  assert.equal(reasonFromIcon('retweet_icon'), 'repost');
  assert.equal(reasonFromIcon('person_icon'), 'follow');
  assert.equal(reasonFromIcon('', 'Aliceさんがあなたをフォローしました'), 'follow');
  assert.equal(reasonFromIcon('bird_icon', 'something else'), null);
});

test('notification items name the author of their target post', () => {
  const json = {
    globalObjects: {
      users: { 1: { screen_name: 'shun', name: 'shun' }, 2: { screen_name: 'realme', name: 'Me' } },
      tweets: { 9: { full_text: 'post', user_id_str: '2' } },
      notifications: { n1: { id: 'n1', icon: { id: 'heart_icon' }, timestampMs: '1', message: { text: 'liked' },
        template: { aggregateUserActionsV1: { targetObjects: [{ tweet: { id: '9' } }], fromUsers: [{ user: { id: '1' } }] } } } },
    },
    timeline: { instructions: [{ addEntries: { entries: [{ sortIndex: '1', content: { item: { content: { notification: { id: 'n1' } } } } }] } }] },
  };
  const [like] = normalizeCapturedResponse(json, 'NotificationsRest').notifications;
  assert.equal(like.targetAuthorId, '2');
  assert.equal(like.targetAuthorHandle, 'realme');
});
