// Client-side rank tier mapping (mirrors server/rank.js).
export const TIERS = [
  { id: 'beginner', name: 'Beginner', min: 0, color: '#9ca3af' },
  { id: 'novice', name: 'Novice', min: 800, color: '#a16b3c' },
  { id: 'intermediate', name: 'Intermediate', min: 1200, color: '#9bb0c9' },
  { id: 'advanced', name: 'Advanced', min: 1600, color: '#c99a3c' },
  { id: 'expert', name: 'Expert', min: 2000, color: '#d97757' },
  { id: 'master', name: 'Master', min: 2400, color: '#b26bd0' },
  { id: 'grandmaster', name: 'Grandmaster', min: 2800, color: '#e0b23c' },
];
export function tierForElo(elo) {
  const n = Number(elo) || 1200;
  let t = TIERS[0];
  for (const tier of TIERS) if (n >= tier.min) t = tier;
  return t;
}
export function gradeLabel(tier) {
  return tier ? tier.name : 'Unrated';
}
