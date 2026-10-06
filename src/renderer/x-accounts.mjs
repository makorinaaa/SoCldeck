// X アカウントは partition（ログインセッション）で見分ける。古い保存データには
// partition が無いことがあり、その場合は並び順から決まる。
function xPartitionOf(account, index) {
  return account?.partition || `persist:x-${index}`;
}

// 通知に添えられたアカウントは保存時の写しなので、partition（無ければ表示名）で照合する。
function isSameXAccount(a, b) {
  return Boolean(a && b) && (a.partition || a.username) === (b.partition || b.username);
}

function createXAccounts({ getAccounts, getAccountId = () => null, onHandleLearned = () => {} }) {
  const list = () => getAccounts() || [];
  const userIds = new Map();

  function indexOfPartition(partition) {
    return list().findIndex((account, index) => xPartitionOf(account, index) === partition);
  }

  function byPartition(partition) {
    return list()[indexOfPartition(partition)] || null;
  }

  // 投稿先は表示名（@handle）か partition で指定される
  function partitionForAccountId(accountId) {
    const accounts = list();
    const index = accounts.findIndex((account, position) =>
      account.username === accountId || xPartitionOf(account, position) === accountId);
    return index >= 0 ? xPartitionOf(accounts[index], index) : null;
  }

  // 本当の @handle は、セッションの Cookie にあるユーザー ID と一致する投稿者から知る。
  // 表示名は入力されたまま変えない。
  function refreshUserIds(accounts = list()) {
    accounts.forEach((account, index) => {
      const partition = xPartitionOf(account, index);
      Promise.resolve(getAccountId(partition))
        .then(id => { if (id) userIds.set(partition, String(id)); })
        .catch(() => {});
    });
  }

  function learnHandle(partition, author) {
    const id = userIds.get(partition);
    if (!id || !author?.handle || String(author.id || '') !== id) return;
    const account = byPartition(partition);
    if (!account || account.handle === author.handle) return;
    account.handle = author.handle;
    onHandleLearned(account);
  }

  function learnHandlesFromPosts(partition, posts = []) {
    posts.forEach(post => {
      learnHandle(partition, post?.author);
      learnHandle(partition, post?.quoted?.author);
    });
  }

  return {
    byPartition,
    indexOfPartition,
    learnHandle,
    learnHandlesFromPosts,
    partitionForAccountId,
    refreshUserIds,
  };
}

export { createXAccounts, isSameXAccount, xPartitionOf };
