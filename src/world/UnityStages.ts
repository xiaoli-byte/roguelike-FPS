import type { StageNode } from '../core/types';

export interface UnityStage extends Omit<StageNode, 'theme'> { title: string; available: boolean }
export const UNITY_STAGES: readonly UnityStage[] = [
  {
    "chapter": 0,
    "index": 0,
    "type": "combat",
    "reward": "scroll",
    "title": "古道穿越戈壁",
    "available": true
  },
  {
    "chapter": 0,
    "index": 1,
    "type": "combat",
    "reward": "scroll",
    "title": "雅丹迷城",
    "available": true
  },
  {
    "chapter": 0,
    "index": 2,
    "type": "combat",
    "reward": "scroll",
    "title": "沉沙古城",
    "available": true
  },
  {
    "chapter": 0,
    "index": 3,
    "type": "boss",
    "reward": "weapon",
    "title": "鸣沙山月牙泉 · 旱魃",
    "available": true
  },
  {
    "chapter": 1,
    "index": 0,
    "type": "combat",
    "reward": "scroll",
    "title": "冰瀑栈道",
    "available": true
  },
  {
    "chapter": 1,
    "index": 1,
    "type": "combat",
    "reward": "scroll",
    "title": "昆仑天阙 · 开明九门",
    "available": true
  },
  {
    "chapter": 1,
    "index": 2,
    "type": "combat",
    "reward": "scroll",
    "title": "瑶池冰湖",
    "available": true
  },
  {
    "chapter": 1,
    "index": 3,
    "type": "boss",
    "reward": "weapon",
    "title": "北冥冰台 · 鲲鹏",
    "available": true
  },
  {
    "chapter": 2,
    "index": 0,
    "type": "combat",
    "reward": "scroll",
    "title": "熔湖堤道",
    "available": true
  },
  {
    "chapter": 2,
    "index": 1,
    "type": "combat",
    "reward": "scroll",
    "title": "铸神井",
    "available": true
  },
  {
    "chapter": 2,
    "index": 2,
    "type": "combat",
    "reward": "scroll",
    "title": "铸范大坊",
    "available": true
  },
  {
    "chapter": 2,
    "index": 3,
    "type": "boss",
    "reward": "weapon",
    "title": "祝融炉心 · 火麒麟",
    "available": true
  },
  {
    "chapter": 3,
    "index": 0,
    "type": "combat",
    "reward": "scroll",
    "title": "折多垭口·天路草甸",
    "available": true
  },
  {
    "chapter": 3,
    "index": 1,
    "type": "combat",
    "reward": "scroll",
    "title": "大渡河·铁索桥峡谷",
    "available": false
  },
  {
    "chapter": 3,
    "index": 2,
    "type": "combat",
    "reward": "scroll",
    "title": "彩林海子",
    "available": true
  },
  {
    "chapter": 3,
    "index": 3,
    "type": "boss",
    "reward": "weapon",
    "title": "神山海子 · 雷泽雷神",
    "available": false
  }
];
export const UNITY_FINAL_STAGE = UNITY_STAGES.filter(stage => stage.available).at(-1) ?? UNITY_STAGES[0];
