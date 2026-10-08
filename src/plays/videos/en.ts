// Reference videos for the English UI (SPEC §6.3). Edit this file to add, change or remove links.
// Keys are play ids (src/plays/library.ts), at most 3 videos per play, shared by all shot options of a play.
// Plays that are not listed here show no videos in the English UI (the Traditional Chinese list is zh-Hant.ts).
// URLs must be https; plays.test.ts checks the ids, counts and URL format.

import type { PlayVideo } from '.';

const DHO_BASICS: PlayVideo[] = [{ title: 'DHO: Dribble Pitch/Dribble Screen', url: 'https://www.youtube.com/watch?v=Oqzx1JElX5g' }];

export const EN_VIDEOS: Readonly<Record<string, readonly PlayVideo[]>> = {
  // High pick and roll: Pick and Roll
  'high-pnr-roll': [
    { title: 'How Pick And Roll In Basketball', url: 'https://www.youtube.com/watch?v=bwT15tI3H70' },
    { title: 'OVER THE TOP PASS TO ROLL MAN', url: 'https://www.youtube.com/watch?v=ZRY_dhTSWTM' },
  ],
  // High pick and roll: Spain Pick and Roll
  'high-pnr-spain': [{ title: '3x3 Playbook - Spanish Pick and Roll', url: 'https://www.youtube.com/watch?v=db22lmGpGbM' }],
  // Cutting: Pass and Cut
  'cut-give-go': [{ title: 'The Give-and-Go', url: 'https://www.youtube.com/watch?v=LOL5ZNuP7vk' }],
  // Cutting: Backdoor Cut
  'cut-backdoor': [
    { title: 'The Backdoor Cut', url: 'https://www.youtube.com/watch?v=O4EX3P76h_U' },
    { title: 'NBA Cutting- Backdoor Cuts', url: 'https://www.youtube.com/watch?v=RzfXykjY_L4' },
  ],
  // Off-ball screen: Back Screen
  'offball-back': [
    { title: '4 High Set Play - Back Screen and Ball Screen Options', url: 'https://www.youtube.com/watch?v=2S8FFvIP9_U' },
  ],
  // Off-ball screen: Post Split
  'offball-post-split': [{ title: 'Golden State Offense - Post Split', url: 'https://www.youtube.com/watch?v=ivcb5niZ-PM' }],
  // Off-ball screen: Flare Screen
  'offball-flare': [{ title: 'The BEST Way to Use Flare Screens in Basketball', url: 'https://www.youtube.com/watch?v=Fy_rEXaU4jM' }],
  // Hand-off: DHO to Drive
  'dho-drive': DHO_BASICS,
  // Hand-off: DHO to Shoot
  'dho-shoot': DHO_BASICS,
  // Hand-off: Fake Hand-Off
  'dho-fake': [{ title: 'Fake Handoff Breakdown', url: 'https://www.youtube.com/watch?v=41sDICfHVlo' }],
};
