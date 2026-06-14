// ReAct 循环的类型。

/** 一步：模型的思考 + 它调用的工具与结果。 */
export interface ReActStep {
  step: number;
  /** 模型本步的文字思考（content，截断） */
  thought?: string;
  /** 调用的工具名 */
  tool?: string;
  /** 工具参数 */
  args?: unknown;
  /** 工具返回摘要 */
  result?: string;
  /** 该步执行后的页面观察文本（判官证据） */
  observation?: string;
  /** 多步封装工具的内部步骤与中间观察 */
  trace?: { label: string; observation?: string }[];
  ok?: boolean;
}

/** 单场景一次 ReAct 运行的结果。 */
export interface ReActRunResult {
  /** 是否以 browser.done 正常结束 */
  done: boolean;
  /** 是否因步数上限结束 */
  timedOut: boolean;
  steps: ReActStep[];
  /** 结束时的页面观察文本 */
  finalObservation: string;
  /** agent 自评摘要（browser.done 的 result 或最后一段正文） */
  doneSummary?: string;
  /** P1 轻量启发式：done 且未超时即视作"可能成功" */
  likelySuccess: boolean;
}
