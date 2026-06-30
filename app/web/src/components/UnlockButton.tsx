import { useEffect } from "react";
import { useRunlock } from "../store/useRunlock";

// 顶部强制解锁按钮：锁被占用时显示，点一下清掉僵尸锁。
// 轮询锁状态（每 2s）；无占用时不渲染，保持界面干净。
export function UnlockButton() {
  const running = useRunlock((s) => s.running);
  const refresh = useRunlock((s) => s.refresh);
  const clear = useRunlock((s) => s.clear);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 2000);
    return () => clearInterval(t);
  }, [refresh]);

  if (!running) return null;

  const elapsed = Math.round((Date.now() - new Date(running.startedAt).getTime()) / 1000);
  return (
    <button className="btn btn--sm btn--unlock" onClick={() => void clear()} title={`强制清除占用锁（${running.kind}，已 ${elapsed}s）`}>
      🔓 强制解锁（{running.kind}·{elapsed}s）
    </button>
  );
}
