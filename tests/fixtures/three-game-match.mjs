/** 21-19, 0-21, then 21-15 with the deciding game reaching 11-10. */
export function threeGameWinners() {
  const winners = [];
  for (let i = 0; i < 19; i++) winners.push("p1", "p2");
  winners.push("p1", "p1");
  for (let i = 0; i < 21; i++) winners.push("p2");
  for (let i = 0; i < 10; i++) winners.push("p1", "p2");
  winners.push("p1");
  for (let i = 0; i < 5; i++) winners.push("p2");
  for (let i = 0; i < 10; i++) winners.push("p1");
  return winners;
}
