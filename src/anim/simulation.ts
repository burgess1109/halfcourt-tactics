import type { Tactic } from '../model/types';
import { redAt, simulateDefense, type DefenseResult } from '../sim/defenseSim';
import { buildTimeline, poseAt, type Pose, type Timeline } from './timeline';

/** 一次完整的模擬：藍隊照路線、紅隊由防守 AI 推進 */
export interface Simulation {
  timeline: Timeline;
  defense: DefenseResult;
}

export function simulate(tactic: Tactic): Simulation {
  const timeline = buildTimeline(tactic);
  return { timeline, defense: simulateDefense(tactic, timeline) };
}

export interface FullPose extends Pose {
  /** 被掩護卡住的紅隊球員 */
  stuck: Set<string>;
}

export function fullPoseAt(tactic: Tactic, sim: Simulation, t: number): FullPose {
  const pose = poseAt(tactic, sim.timeline, t);
  const red = redAt(sim.defense, t);
  return { ...pose, positions: { ...pose.positions, ...red.positions }, stuck: red.stuck };
}
