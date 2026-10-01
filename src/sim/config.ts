// 模擬係數集中在這裡（SPEC §6.1），之後依實際結果校正。

// 球員圓標直徑約 1.44 m（為了手機好點而放大），距離太近時兩個圓會疊在一起，
// 所以防守距離比真實比賽略大。

/** 防守持球者時，與對位者的距離（公尺） */
export const ON_BALL_GAP = 1.5;
/** 防守無球者時，與對位者的距離（公尺），站在靠籃框那一側 */
export const OFF_BALL_GAP = 2.0;
/** 對位者在籃下時，至少保持這個距離，兩個圓標才不會疊在一起（公尺） */
export const MIN_GAP = 1.45;

/**
 * 防守移動係數：防守者面對對位者側滑、倒退，比往前衝刺慢。
 * 讓防運球者時只能慢慢追回（掩護才有效果），防空切時會被甩開。
 */
export const DEFENSE_SPEED_FACTOR = 0.9;

/** 模擬的時間步長（秒） */
export const DT = 1 / 60;
/** 防守者的反應時間：看到的是這麼久之前的場上狀況（秒） */
export const REACTION_TIME = 0.2;

/** 防守者不能穿過進攻者：兩人中心至少保持這個距離（公尺） */
export const BODY_DISTANCE = 1.3;
/**
 * 防守者中心離掩護者中心這麼近，而且掩護者擋在他要去的方向上，就算被掩護到（公尺）。
 * 要比 BODY_DISTANCE 大，否則防守者會先被身體碰撞推開，永遠碰不到掩護。
 */
export const SCREEN_CONTACT = 1.4;
/** 掩護者離開掩護點超過這個距離，掩護就失效（公尺） */
export const SCREEN_HOLD_RADIUS = 0.5;

/** 擠過：被卡住的基本時間（秒），掩護者每比防守者高 1 cm 多卡這麼久 */
export const FIGHT_OVER_DELAY = 0.45;
export const FIGHT_OVER_PER_CM = 0.015;
export const FIGHT_OVER_RANGE = { min: 0.25, max: 0.9 } as const;

/** 換防：兩位防守者交換對位前的反應時間（秒） */
export const SWITCH_DELAY = 0.3;

/**
 * 阻絕（SPEC §6.2）：防外圍無球的人時，站到傳球路線上。
 * 位置 = 對位者 + 往持球者方向 DENY_TOWARD_BALL + 往籃框方向 DENY_TOWARD_RIM。
 */
export const DENY_TOWARD_BALL = 1.3;
export const DENY_TOWARD_RIM = 0.5;
/** 對位者離籃框超過這個距離（公尺）才阻絕；在籃下附近就站在人和籃框之間 */
export const DENY_MIN_RIM_DISTANCE = 4.5;

/**
 * 被甩開：防守者離籃框比對位者還遠超過這個距離（公尺），代表對位者已經切到他前面，
 * 防守者沒辦法穿過去，只能從後面追（SPEC §6.2）。
 */
export const BEATEN_MARGIN = 0.3;
