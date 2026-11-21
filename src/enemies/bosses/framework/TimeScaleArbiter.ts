/**
 * 时间缩放仲裁已提到 core（M11d，docs/threejs-migration.md 4.7）：实现在 src/core/TimeScaleArbiter.ts，
 * 首领框架、登场演出、后处理照旧从这里引用，行为不变。
 */
export { TimePriority, TimeScaleArbiter, arbiterFor, type TimeScaleHandle } from '../../../core/TimeScaleArbiter';
