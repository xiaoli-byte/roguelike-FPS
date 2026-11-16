// Unity 文本序列化（YAML 子集）读取：只够读 AnimatorController（*.controller）与 *.meta 的 guid，不依赖 yaml 包。
//
//   parseUnityYaml(text)        → Map<fileID, { classId, type, body }>（body = 文档里第一层对象，如 AnimatorState 的字段）
//   readMetaGuid(text)          → guid
//   readAnimatorController(text, clipNameByGuid)
//                               → 控制器拓扑（参数、层、状态、转换、混合树），供网页 AnimatorStateMachine 直接用
//
// Unity 的 YAML 很规整：两格缩进；序列项和父键同一缩进（`m_Transitions:` 下一行就是 `- {fileID: …}`）；
// 行内映射 `{fileID: 7400000, guid: …, type: 2}` 不嵌套；`m_Tag: ` 冒号后带空格 = 空字符串，`m_Transitions:` 不带 = 下面是块。

/** 行内标量：数字 / 字符串 */
function scalar(raw) {
  const s = raw.trim();
  if (s === '') return '';
  if (/^-?\d+(\.\d+)?(e[-+]?\d+)?$/i.test(s)) return Number(s);
  return s;
}

/** 行内映射 / 序列：{a: 1, b: x}、[]、{} */
function flow(raw) {
  const s = raw.trim();
  if (s === '[]') return [];
  if (s === '{}') return {};
  if (s.startsWith('{') && s.endsWith('}')) {
    const out = {};
    for (const part of s.slice(1, -1).split(',')) {
      const k = part.indexOf(':');
      if (k < 0) continue;
      const key = part.slice(0, k).trim();
      // fileID 是 64 位整数（常为负），转成 JS 数会丢精度：引用一律按字符串比较
      out[key] = key === 'fileID' || key === 'guid' ? part.slice(k + 1).trim() : scalar(part.slice(k + 1));
    }
    return out;
  }
  return scalar(s);
}

const indentOf = (line) => line.length - line.trimStart().length;

/** 从 lines[i] 开始、缩进为 indent 的块（映射或序列）；返回 [值, 下一行] */
function block(lines, i, indent) {
  if (i >= lines.length) return [null, i];
  const first = lines[i];
  if (indentOf(first) === indent && first.trimStart().startsWith('- ')) return seq(lines, i, indent);
  return map(lines, i, indent);
}

function seq(lines, i, indent) {
  const out = [];
  while (i < lines.length && indentOf(lines[i]) === indent && lines[i].trimStart().startsWith('- ')) {
    const content = lines[i].slice(indent + 2);
    if (/^[A-Za-z_][\w]*:( |$)/.test(content)) {
      // `- key: value` 开头的映射项：把 "- " 当成两格缩进，按映射读
      const copy = lines.slice();
      copy[i] = ' '.repeat(indent + 2) + content;
      const [v, next] = map(copy, i, indent + 2);
      out.push(v);
      i = next;
    } else {
      out.push(flow(content));
      i++;
    }
  }
  return [out, i];
}

function map(lines, i, indent) {
  const out = {};
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') { i++; continue; }
    const ind = indentOf(line);
    if (ind < indent || (ind === indent && line.trimStart().startsWith('- '))) break;
    if (ind > indent) { i++; continue; } // 读不懂的续行（多行字符串）：跳过
    const body = line.slice(indent);
    const k = body.indexOf(':');
    if (k < 0) { i++; continue; }
    const key = body.slice(0, k);
    const rest = body.slice(k + 1);
    i++;
    if (rest === '') {
      // 下面是块：更深的缩进，或同缩进的序列
      const next = lines[i];
      if (next !== undefined && (indentOf(next) > indent || (indentOf(next) === indent && next.trimStart().startsWith('- ')))) {
        const [v, n] = block(lines, i, indentOf(next));
        out[key] = v;
        i = n;
      } else out[key] = null;
    } else out[key] = flow(rest);
  }
  return [out, i];
}

/** 整个文件 → fileID → 文档 */
export function parseUnityYaml(text) {
  const docs = new Map();
  const parts = text.replace(/\r\n/g, '\n').split(/^--- !u!(\d+) &(-?\d+)[^\n]*\n/m);
  // split 带捕获组：[前言, classId, fileID, 正文, classId, fileID, 正文, …]
  for (let k = 1; k < parts.length; k += 3) {
    const classId = Number(parts[k]);
    const fileId = parts[k + 1];
    const lines = (parts[k + 2] ?? '').split('\n');
    const head = lines[0] ?? '';
    const type = head.replace(/:\s*$/, '').trim();
    const [body] = map(lines, 1, 2);
    docs.set(fileId, { classId, type, body });
  }
  return docs;
}

export function readMetaGuid(text) {
  return /^guid:\s*([0-9a-f]+)/m.exec(text)?.[1] ?? null;
}

const PARAM_TYPES = { 1: 'float', 3: 'int', 4: 'bool', 9: 'trigger' };
const CONDITION_MODES = { 1: 'if', 2: 'ifNot', 3: 'greater', 4: 'less', 6: 'equals', 7: 'notEqual' };
const ref = (r) => (r && typeof r === 'object' && r.fileID !== undefined && String(r.fileID) !== '0' ? String(r.fileID) : null);

/**
 * AnimatorController → 网页状态机定义。
 * clipNameByGuid：片段资产 guid → 状态机里用的片段名（<资产>_<状态> 去掉资产前缀，与 native-anim 的 clips 键一致）
 */
export function readAnimatorController(text, clipNameByGuid) {
  const docs = parseUnityYaml(text);
  const get = (id) => (id ? docs.get(id) : undefined);
  const ctrl = [...docs.values()].find((d) => d.type === 'AnimatorController');
  if (!ctrl) throw new Error('没有 AnimatorController');
  const unknownClips = new Set();
  const clipOf = (m) => {
    if (!m || !m.guid) return null;
    const name = clipNameByGuid.get(m.guid);
    if (!name) unknownClips.add(m.guid);
    return name ?? null;
  };
  const motion = (m) => {
    if (!m) return null;
    if (m.guid) return { clip: clipOf(m) };
    const tree = get(ref(m));
    if (tree?.type !== 'BlendTree') return null;
    const b = tree.body;
    return {
      blend: {
        type: b.m_BlendType === 0 ? '1d' : `type${b.m_BlendType}`,
        param: b.m_BlendParameter,
        children: (b.m_Childs ?? []).map((c) => ({ clip: clipOf(c.m_Motion), threshold: c.m_Threshold, timeScale: c.m_TimeScale ?? 1 })),
      },
    };
  };
  const stateName = (id) => get(id)?.body?.m_Name ?? null;
  const transition = (id) => {
    const t = get(id)?.body;
    if (!t || t.m_Mute) return null; // 静音的转换 Unity 不执行
    return {
      to: stateName(ref(t.m_DstState)),
      exit: !!t.m_IsExit,
      conditions: (t.m_Conditions ?? []).map((c) => ({ mode: CONDITION_MODES[c.m_ConditionMode] ?? `mode${c.m_ConditionMode}`, param: c.m_ConditionEvent, threshold: c.m_EventTreshold ?? 0 })),
      hasExitTime: !!t.m_HasExitTime,
      exitTime: t.m_ExitTime ?? 0,
      duration: t.m_TransitionDuration ?? 0,
      fixedDuration: t.m_HasFixedDuration !== 0,
      offset: t.m_TransitionOffset ?? 0,
      canTransitionToSelf: !!t.m_CanTransitionToSelf,
    };
  };
  const layers = (ctrl.body.m_AnimatorLayers ?? []).map((l, layerIndex) => {
    const sm = get(ref(l.m_StateMachine))?.body ?? {};
    const states = (sm.m_ChildStates ?? []).map((cs) => {
      const s = get(ref(cs.m_State))?.body ?? {};
      return {
        name: s.m_Name,
        motion: motion(s.m_Motion),
        speed: s.m_Speed ?? 1,
        speedParam: s.m_SpeedParameterActive ? s.m_SpeedParameter : null,
        writeDefaults: s.m_WriteDefaultValues !== 0,
        transitions: (s.m_Transitions ?? []).map((t) => transition(ref(t))).filter(Boolean),
      };
    });
    return {
      name: l.m_Name,
      blending: l.m_BlendingMode === 1 ? 'additive' : 'override',
      // 底层的权重 Unity 不看（恒为 1；控制器里存的是 0）
      weight: layerIndex === 0 ? 1 : l.m_DefaultWeight ?? 1,
      defaultState: stateName(ref(sm.m_DefaultState)),
      states,
      anyState: (sm.m_AnyStateTransitions ?? []).map((t) => transition(ref(t))).filter(Boolean),
    };
  });
  const parameters = (ctrl.body.m_AnimatorParameters ?? []).map((p) => {
    const type = PARAM_TYPES[p.m_Type] ?? `type${p.m_Type}`;
    const def = type === 'float' ? p.m_DefaultFloat ?? 0 : type === 'int' ? p.m_DefaultInt ?? 0 : !!p.m_DefaultBool;
    return { name: p.m_Name, type, default: def };
  });
  return { name: ctrl.body.m_Name, parameters, layers, unknownClips: [...unknownClips] };
}
