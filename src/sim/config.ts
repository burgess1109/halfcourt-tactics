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
 * 防守距離（SPEC §6.2，站位與對位頁選擇）：
 * - 一般：上面的 ON_BALL_GAP / OFF_BALL_GAP，外圍無球者平常協防站位，對位者往外跑才阻絕。
 * - 緊貼：距離縮小（持球者貼到圓標不重疊的極限），外圍無球者一律阻絕傳球路線。
 *   出手時干擾比較大、外圍不好接球；代價是持球者切入、無球者背切時比較容易被甩到身後。
 */
export const PRESSURE_GAPS = {
  normal: { onBall: ON_BALL_GAP, offBall: OFF_BALL_GAP, alwaysDeny: false },
  tight: { onBall: MIN_GAP, offBall: 1.5, alwaysDeny: true },
} as const;

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

/**
 * 擋拆擠過時，掩護者的防守者暫時協防持球者（SPEC §6.2）。
 * 沉退：退到持球者和籃框的連線上、離籃框 DROP_DEPTH 公尺（最多到離持球者 ON_BALL_GAP），保護籃下。
 * 上提：站到持球者和籃框之間、離持球者 ON_BALL_GAP，干擾投籃與切入。
 * 協防至少 HELP_MIN 秒（掩護常在持球者開始運球前就設好，隊友一開始看起來沒有落後）；
 * 之後被掩護的隊友回到離理想位置 HELP_RECOVERED 公尺內、而且離籃框比持球者近 HELP_FRONT 公尺以上（真的擋在前面），
 * 或持球者把球傳出去、或過了 HELP_MAX 秒，就回去盯掩護者。
 * 沉退的位置在罰球線下方，所以持球者在中距離以外急停跳投會比較空。
 */
export const DROP_DEPTH = 3.0;
export const HELP_RECOVERED = 1.0;
export const HELP_MIN = 1.0;
export const HELP_FRONT = 0.8;
export const HELP_MAX = 2.5;

/**
 * 弱邊補防（SPEC §6.2，設定為「弱邊補防」時）：持球者甩開自己的防守者、往籃框切時，
 * 另外兩位無球防守者中，來得及的人補到切入路線上。
 * - 觸發：持球者離籃框 DRIVE_HELP_MAX_RIM 公尺以內、往籃框的速度 ≥ DRIVE_HELP_MIN_SPEED，
 *   而且他的防守者已經沒有正常擋在前面：離籃框只比持球者近不到 DRIVE_HELP_BEATEN 公尺（正常約 ON_BALL_GAP）。
 *   等到真的被超過才補就太晚了，切入者領先半步時補防就要啟動。
 * - 來不來得及：在持球者到籃框的直線上、離籃框 DRIVE_HELP_SPOTS 公尺的點，補防者（反應時間＋距離÷速度）
 *   要比持球者（距離÷速度）早到 DRIVE_HELP_MARGIN 秒以上；選離籃框最遠的點。都來不及就不補。
 * - 結束：持球者把球傳出去、他的防守者追回前面（離理想位置 HELP_RECOVERED 以內，而且離籃框比持球者近
 *   DRIVE_HELP_RECOVERED_FRONT 以上；要比觸發的 DRIVE_HELP_BEATEN 嚴格，否則一補就放）、或滿 DRIVE_HELP_MAX 秒。
 */
export const DRIVE_HELP_MAX_RIM = 6.0;
export const DRIVE_HELP_BEATEN = 1.0;
export const DRIVE_HELP_RECOVERED_FRONT = 1.3;
export const DRIVE_HELP_MIN_SPEED = 2.0;
export const DRIVE_HELP_SPOTS = [4.0, 3.5, 3.0, 2.5, 2.0, 1.5] as const;
export const DRIVE_HELP_MARGIN = 0.1;
export const DRIVE_HELP_MAX = 2.0;
/** 補防不到這麼久（秒，例如剛補就傳球）就不寫評語 */
export const DRIVE_HELP_COMMENT_MIN = 0.2;
/** 補防結束後，過這麼久才會再補防（秒） */
export const DRIVE_HELP_COOLDOWN = 0.5;

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
/** 對位者離持球者這麼近（公尺，例如正在幫持球者掩護）時不阻絕，站在人和籃框之間 */
export const DENY_MIN_BALL_DISTANCE = 3.5;

/**
 * 被甩開：防守者離籃框比對位者還遠超過這個距離（公尺），代表對位者已經切到他前面，
 * 防守者沒辦法穿過去，只能從後面追（SPEC §6.2）。
 */
export const BEATEN_MARGIN = 0.3;
/**
 * 而且對位者要真的擋在防守者和籃框之間：從對位者看出去，防守者和籃框的夾角大於 120°。
 * 只是往籃下走（例如要位）、防守者還在旁邊時，不算被甩開。
 */
export const BEATEN_COS = -0.5;

// ---- 評分（SPEC §6.4、§7.2） ----

/**
 * 空檔命中率，依能力等級 0（劣勢）→ 4（優勢）。
 * 兩端由使用者指定；中間依一般業餘球員空檔出手的水準估計（弧外多數人集中在 30% 上下）。
 */
export const PAINT_RATE = [0.5, 0.6, 0.68, 0.77, 0.85] as const; // 禁區（禁區終結）
export const MID_RATE = [0.35, 0.43, 0.5, 0.58, 0.65] as const; // 中距離（外線投射）
export const THREE_RATE = [0.1, 0.22, 0.32, 0.39, 0.45] as const; // 弧外（外線投射）

/**
 * 干擾的判定：防守者離籃框不比出手者遠超過這個值（公尺）才算在出手者與籃框之間（含並排）。
 * 比出手者離籃框更遠的防守者已經被甩開，不算干擾。用距離比較，靠近籃框時也不會因為方向變化而誤判。
 */
export const CONTEST_SIDE_MARGIN = 0.3;
/** 最近的防守者在這個距離以外，就算完全空檔（公尺） */
export const OPEN_DISTANCE = 3.0;
/** 防守者貼身（BODY_DISTANCE）時，命中率剩下的比例 */
export const CONTESTED_FACTOR = 0.5;
/**
 * 身高錯位：出手者每比干擾他的防守者高 1 cm，干擾造成的命中率損失少 MISMATCH_PER_CM（禁區出手）；
 * 跳投（中距離、弧外）效果打 MISMATCH_JUMPSHOT_WEIGHT 折。
 * 損失最多少 MISMATCH_MAX_REDUCTION；防守者比較高時，損失最多變成 1 + MISMATCH_MAX_INCREASE 倍。
 * 例：換防後在禁區高 20 cm → 干擾損失少 80%。
 */
export const MISMATCH_PER_CM = 0.04;
export const MISMATCH_JUMPSHOT_WEIGHT = 0.5;
export const MISMATCH_MAX_REDUCTION = 0.8;
export const MISMATCH_MAX_INCREASE = 0.5;
/** 出手前有運球時，依單打能力額外拉開的距離（公尺），0（劣勢）→ 4（優勢） */
export const ISO_SEPARATION = [0, 0.15, 0.3, 0.45, 0.6] as const;

/**
 * 評等門檻（預期得分），由高到低。依 18 套戰術的實測結果校正（SPEC §6.4）：
 * 平均能力的人空檔投弧外 ≈ 0.66（A）、甩開防守者上籃 ≈ 0.49（B）、被貼身干擾 < 0.36（D）。
 */
export const GRADE_THRESHOLDS = [
  { grade: 'S', min: 0.75 },
  { grade: 'A', min: 0.6 },
  { grade: 'B', min: 0.48 },
  { grade: 'C', min: 0.36 },
] as const;

/** 其他人比出手者多這麼多預期得分，才列為「更好的選擇」 */
export const BETTER_OPTION_MARGIN = 0.1;
/** 兩名藍隊球員距離小於這個值（公尺），算擠壓空間 */
export const SPACING_DISTANCE = 3.0;

/**
 * 協防站位：沒有要阻絕時，防外圍無球者站在「對位者與籃框之間」（OFF_BALL_GAP），
 * 再往持球者方向偏 HELP_SHADE 公尺，守住內切（SPEC §6.2）。
 */
export const HELP_SHADE = 0.8;
/** 對位者往外（遠離籃框）跑的速度超過這個值（m/s），代表想出來接球，防守者才上去阻絕 */
export const DENY_TRIGGER_SPEED = 1.5;
/** 估算對位者速度用的時間間隔（秒） */
export const VELOCITY_DT = 0.1;

/**
 * 往球的方向靠（jump to the ball）：對位者把球傳出去後，防守者有 JUMP_DURATION 秒
 * 往接球者的方向移動 JUMP_TO_BALL 公尺。對位者這時往籃下切（傳切），就會從防守者背後過去。
 */
export const JUMP_DURATION = 0.8;
export const JUMP_TO_BALL = 2.0;
