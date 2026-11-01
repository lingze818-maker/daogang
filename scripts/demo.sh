#!/usr/bin/env bash
# 终端里把主窗回复、打断和招领跑一遍。不需要 API key，也不录音成 GIF。
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -z "${DAOGANG_HOME:-}" ]]; then
  DAOGANG_HOME="$(mktemp -d)"
  export DAOGANG_HOME
fi
export DEEPSEEK_API_KEY=""
export DAOGANG_EXECUTOR=local
export DAOGANG_DSH_ROOT=
unset DAOGANG_FAIL_LANE

echo "== home ${DAOGANG_HOME}"
echo "== 普通任务，成为当前工单"
pnpm dispatch -- "帮我补上安装说明"
echo "== 更急的 mixed：主窗回复不等任务腿，并打断上一张"
pnpm dispatch -- "谢谢，马上帮我修一下 bug"
echo "== 更低优先级只排队"
pnpm dispatch -- "不急，帮我写文档"
echo "== 任务腿失败，落成招领"
DAOGANG_FAIL_LANE=task pnpm dispatch -- "帮我排查安装"
echo "== 看板"
DAOGANG_FAIL_LANE= pnpm board
