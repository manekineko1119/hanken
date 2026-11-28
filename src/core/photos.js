// 写真の決まり（純粋な部分）。Supabase やブラウザの API は data/photos.js に置く。
export const MAX_PHOTOS = 5;
export const MAX_PHOTO_BYTES = 1048576; // 入れ物 live-photos の上限（1MB）
export const PHOTO_URL_SECONDS = 3600;

export const PHOTO_MSG = {
  limit: '写真は1つのライブに5枚までです',
  failed: '写真を保存できませんでした。通信を確かめて、もう一度押してください',
  tooBig: '写真が大きすぎて保存できませんでした',
  deleteFailed: '写真を消せませんでした。通信を確かめて、もう一度押してください',
  unreadable: 'この写真は読み込めませんでした。別の写真を選んでください',
  loadFailed: '写真を読み込めませんでした。通信を確かめてください',
};

// Storage のパス。先頭が自分の user_id であること（Storage の権限がこの形を見る）。
export function photoPath(userId, liveId, photoId) {
  return `${userId}/${liveId}/${photoId}.jpg`;
}

export function canAddPhoto(count) {
  return count < MAX_PHOTOS;
}
