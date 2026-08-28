set -e
cd /Users/taylor-larsen/Code/fantasy-drafter/.claude/worktrees/agent-ac4384ffa2c585741
# A: no room needs at all -- pure coupled rank model
sed -e 's/^const ROOM_NEED_BONUS = 12;/const ROOM_NEED_BONUS = 0;/' \
    -e 's/^const ROOM_STOCKED_PENALTY = 60;/const ROOM_STOCKED_PENALTY = 0;/' \
    tmp-probe/value.sim.js > js/value.js
node tmp-probe/dump.mjs tmp-probe/noneeds.json
# B: four times the runs -- is the delta Monte Carlo noise?
sed -e 's/^const ROOM_RUNS = 64;/const ROOM_RUNS = 256;/' tmp-probe/value.sim.js > js/value.js
node tmp-probe/dump.mjs tmp-probe/runs256.json
cp tmp-probe/value.sim.js js/value.js
echo DONE
