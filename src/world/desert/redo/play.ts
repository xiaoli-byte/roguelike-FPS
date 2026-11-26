// 自动生成（一次性搬运）：node scripts/desert/redo-extract-play.mjs，2026-11-26 从 Unity 导出的旧场景搬来第一章的玩法数据。
// 用户：「现在是要从unity迁移到threeJS，以后unity是要删除的」——重做版运行时只读这份，不再读 public/assets/unity-levels；
// 以后要改波次 / 奖励 / 调色就直接改这里（脚本只在 Unity 导出还在时重跑对照用）。
import type { UnityEnvironment, UnityWave } from '../../UnityLevelLibrary';
import type { QuicksandData, SoftBoundaryTuning, WeatherRegionData } from '../../mechanisms/MechanismData';
import type { VolumeOverrides } from '../../../render/UrpVolume';

export interface PlayEncounter {
  title: string;
  optional: boolean;
  /** 先清哪些据点才开（据点名） */
  requires: string[];
  reward: string;
  chestOffset: [number, number, number];
  difficulty: number;
  triggerRadius: number;
  arenaRadius: number;
  entryDepth: number;
  requireSight: boolean;
  autoTrigger: boolean;
  roadside: boolean;
  /** 站位角色序列（0 自动 / 1 正面 / 2 侧袭 / 3 远程 / 4 狙击 / 5 炮手 / 6 辅助）和刷怪道：编译时按白盒场地重摆锚点 */
  roles: number[];
  lanes: number[];
  waves: UnityWave[];
}

export interface MapPlay {
  title: string;
  encounters: PlayEncounter[];
  caches: { title: string; reward: string; guard: string | null }[];
  bosses: { id: string; radius: number }[];
  /** 光 / 雾 / 环境光（天空盒去掉了） */
  environment: UnityEnvironment;
  weather: { baseFogColor: [number, number, number, number]; baseFogStart: number; baseFogEnd: number; theme: string; whiteoutProfile: string; baseWind: number; region: Omit<WeatherRegionData, 'center' | 'radius' | 'from'> | null } | null;
  boundaryTuning: SoftBoundaryTuning | null;
  /** 流沙的参数模板（位置按白盒） */
  quicksand: Omit<QuicksandData, 'scenePath' | 'position' | 'rotation' | 'scale' | 'yaw' | 'matrix'> | null;
  camp: { safeRadius: number; openShop: boolean; restoreOnArrive: boolean } | null;
  safeZone: { radius: number; height: number; pushMargin: number; carveNavMesh: boolean } | null;
  /** 后期调色（旧场景 Volume 混好的结果） */
  grade: VolumeOverrides | null;
}

export const PLAY: Record<string, MapPlay> = {
 "1-1": {
  "title": "古道穿越戈壁",
  "encounters": [
   {
    "title": "河床东岸 · 伏沙",
    "optional": true,
    "requires": [],
    "reward": "",
    "chestOffset": [
     0,
     0,
     0
    ],
    "difficulty": 0,
    "triggerRadius": 9,
    "arenaRadius": 14,
    "entryDepth": 2,
    "requireSight": true,
    "autoTrigger": true,
    "roadside": true,
    "roles": [
     0,
     0,
     0,
     0
    ],
    "lanes": [
     0,
     0,
     0,
     0
    ],
    "waves": [
     {
      "label": "河床东岸 · 伏沙",
      "hint": "沙魇伏在河床沙里——脚下亮圈就跑开",
      "triggerRemaining": 1,
      "delay": 1.6,
      "entries": [
       {
        "enemy": "jerboa_blade",
        "count": 2,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 1
       },
       {
        "enemy": "sand_wraith",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 1
       },
       {
        "enemy": "scorpion_archer",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 1
       }
      ]
     }
    ]
   },
   {
    "title": "驼队残骸营地",
    "optional": false,
    "requires": [
     "雅丹石阵",
     "烽燧台地"
    ],
    "reward": "scroll",
    "chestOffset": [
     0,
     0,
     0
    ],
    "difficulty": 0,
    "triggerRadius": 18,
    "arenaRadius": 30,
    "entryDepth": 2,
    "requireSight": true,
    "autoTrigger": true,
    "roadside": false,
    "roles": [
     0,
     0
    ],
    "lanes": [
     0,
     1
    ],
    "waves": [
     {
      "label": "沙暴前锋",
      "hint": "沙暴将至：火浣鼠滚进来逼走位",
      "triggerRemaining": 1,
      "delay": 1.6,
      "entries": [
       {
        "enemy": "fire_rat",
        "count": 3,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "jerboa_blade",
        "count": 3,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": 1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "scorpion_archer",
        "count": 1,
        "elite": true,
        "affix": "",
        "role": 0,
        "arrivalDelay": 2,
        "lane": -1,
        "holdBack": true,
        "via": 0
       }
      ]
     },
     {
      "label": "风沙压境",
      "hint": "沙暴里远程看不清，近战借风沙逼近",
      "triggerRemaining": 2,
      "delay": 1.5,
      "entries": [
       {
        "enemy": "mirage_toad",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "fire_rat",
        "count": 3,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "tomb_beast",
        "count": 1,
        "elite": true,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       }
      ]
     }
    ]
   },
   {
    "title": "黑戈壁砾石滩",
    "optional": false,
    "requires": [],
    "reward": "weapon:beam",
    "chestOffset": [
     0,
     0,
     0
    ],
    "difficulty": 0,
    "triggerRadius": 17,
    "arenaRadius": 28,
    "entryDepth": 2,
    "requireSight": true,
    "autoTrigger": true,
    "roadside": false,
    "roles": [
     2,
     2,
     3
    ],
    "lanes": [
     0,
     1,
     0
    ],
    "waves": [
     {
      "label": "黑戈壁砾石滩",
      "hint": "蝎卫在河岸上压制：贴着长城残墙推进",
      "triggerRemaining": 1,
      "delay": 1.6,
      "entries": [
       {
        "enemy": "jerboa_blade",
        "count": 4,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "scorpion_archer",
        "count": 2,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": 1.2,
        "lane": -1,
        "holdBack": true,
        "via": 0
       }
      ]
     }
    ]
   },
   {
    "title": "商队遗货守军",
    "optional": true,
    "requires": [],
    "reward": "",
    "chestOffset": [
     0,
     0,
     0
    ],
    "difficulty": 0,
    "triggerRadius": 12,
    "arenaRadius": 22,
    "entryDepth": 2,
    "requireSight": true,
    "autoTrigger": false,
    "roadside": false,
    "roles": [
     2,
     2,
     3
    ],
    "lanes": [
     0,
     1,
     0
    ],
    "waves": [
     {
      "label": "商队遗货守军",
      "hint": "击败守军后收取遗货",
      "triggerRemaining": 1,
      "delay": 1.6,
      "entries": [
       {
        "enemy": "jerboa_blade",
        "count": 2,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "scorpion_archer",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       }
      ]
     }
    ]
   },
   {
    "title": "烽燧台地",
    "optional": false,
    "requires": [
     "黑戈壁砾石滩"
    ],
    "reward": "weapon:stormpod:1",
    "chestOffset": [
     0,
     0,
     0
    ],
    "difficulty": 0,
    "triggerRadius": 20,
    "arenaRadius": 30,
    "entryDepth": 2,
    "requireSight": true,
    "autoTrigger": true,
    "roadside": false,
    "roles": [
     1,
     6
    ],
    "lanes": [
     0,
     0
    ],
    "waves": [
     {
      "label": "冲坡",
      "hint": "镇墓兽冲上坡：侧闪，打背后的裂缝；先打台顶的飞天",
      "triggerRemaining": 1,
      "delay": 1.6,
      "entries": [
       {
        "enemy": "tomb_beast",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "apsara",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": 1.5,
        "lane": -1,
        "holdBack": true,
        "via": 0
       }
      ]
     },
     {
      "label": "台下援军",
      "hint": "",
      "triggerRemaining": 1,
      "delay": 1.5,
      "entries": [
       {
        "enemy": "jerboa_blade",
        "count": 3,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "scorpion_archer",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       }
      ]
     }
    ]
   },
   {
    "title": "倒毙驼队",
    "optional": true,
    "requires": [],
    "reward": "",
    "chestOffset": [
     0,
     0,
     0
    ],
    "difficulty": 0,
    "triggerRadius": 9,
    "arenaRadius": 14,
    "entryDepth": 2,
    "requireSight": true,
    "autoTrigger": true,
    "roadside": true,
    "roles": [
     0,
     0,
     0,
     0
    ],
    "lanes": [
     0,
     0,
     0,
     0
    ],
    "waves": [
     {
      "label": "倒毙驼队",
      "hint": "沙匪蹲在倒毙的驼队后面——先点掉蝎卫",
      "triggerRemaining": 1,
      "delay": 1.6,
      "entries": [
       {
        "enemy": "jerboa_blade",
        "count": 3,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 1
       },
       {
        "enemy": "scorpion_archer",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 1
       }
      ]
     }
    ]
   },
   {
    "title": "戍卒残营",
    "optional": true,
    "requires": [],
    "reward": "",
    "chestOffset": [
     0,
     0,
     0
    ],
    "difficulty": 0,
    "triggerRadius": 9,
    "arenaRadius": 14,
    "entryDepth": 2,
    "requireSight": true,
    "autoTrigger": true,
    "roadside": true,
    "roles": [
     0,
     0,
     0,
     0
    ],
    "lanes": [
     0,
     0,
     0,
     0
    ],
    "waves": [
     {
      "label": "戍卒残营",
      "hint": "残营里火浣鼠会顺坡道滚过来——拉开距离",
      "triggerRemaining": 1,
      "delay": 1.6,
      "entries": [
       {
        "enemy": "fire_rat",
        "count": 2,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 1
       },
       {
        "enemy": "jerboa_blade",
        "count": 2,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 1
       },
       {
        "enemy": "scorpion_archer",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 1
       }
      ]
     }
    ]
   },
   {
    "title": "雅丹西 · 河源沙洲",
    "optional": true,
    "requires": [],
    "reward": "",
    "chestOffset": [
     0,
     0,
     0
    ],
    "difficulty": 0,
    "triggerRadius": 9,
    "arenaRadius": 14,
    "entryDepth": 2,
    "requireSight": true,
    "autoTrigger": true,
    "roadside": true,
    "roles": [
     0,
     0,
     0,
     0
    ],
    "lanes": [
     0,
     0,
     0,
     0
    ],
    "waves": [
     {
      "label": "雅丹西 · 河源沙洲",
      "hint": "蜃楼蟾蹲在沙洲上吊射——先打真身",
      "triggerRemaining": 1,
      "delay": 1.6,
      "entries": [
       {
        "enemy": "mirage_toad",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 1
       },
       {
        "enemy": "jerboa_blade",
        "count": 3,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 1
       }
      ]
     }
    ]
   },
   {
    "title": "雅丹石阵",
    "optional": false,
    "requires": [
     "黑戈壁砾石滩"
    ],
    "reward": "pet",
    "chestOffset": [
     0,
     0,
     0
    ],
    "difficulty": 0,
    "triggerRadius": 18,
    "arenaRadius": 30,
    "entryDepth": 2,
    "requireSight": true,
    "autoTrigger": true,
    "roadside": false,
    "roles": [
     5,
     2,
     2
    ],
    "lanes": [
     0,
     1,
     1
    ],
    "waves": [
     {
      "label": "雅丹石阵",
      "hint": "蜃楼蟾在岩丘后吊射：低丘顶能看到它们",
      "triggerRemaining": 1,
      "delay": 1.6,
      "entries": [
       {
        "enemy": "mirage_toad",
        "count": 2,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "jerboa_blade",
        "count": 3,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": 0.6,
        "lane": -1,
        "holdBack": true,
        "via": 0
       }
      ]
     },
     {
      "label": "绕岩伏击",
      "hint": "跳鼠从低丘顶上跳下来，沙魇在沙下潜行——脚下亮圈就跑开",
      "triggerRemaining": 2,
      "delay": 1.2,
      "entries": [
       {
        "enemy": "jerboa_blade",
        "count": 2,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 5
       },
       {
        "enemy": "sand_wraith",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       }
      ]
     }
    ]
   }
  ],
  "caches": [
   {
    "title": "戍卒窖藏",
    "reward": "coins",
    "guard": null
   },
   {
    "title": "商队遗货",
    "reward": "upgrade",
    "guard": "商队遗货守军"
   }
  ],
  "bosses": [],
  "environment": {
   "fog": {
    "enabled": true,
    "mode": 1,
    "color": [
     0.88,
     0.76,
     0.6,
     1
    ],
    "start": 40,
    "end": 260,
    "density": 0.01
   },
   "ambient": {
    "mode": 1,
    "sky": [
     0.44,
     0.52,
     0.7,
     1
    ],
    "equator": [
     0.58,
     0.5,
     0.42,
     1
    ],
    "ground": [
     0.34,
     0.27,
     0.21,
     1
    ],
    "light": [
     0.44,
     0.52,
     0.7,
     1
    ],
    "intensity": 1
   },
   "sun": {
    "forward": [
     -0.6861,
     -0.5878,
     0.4287
    ],
    "color": [
     1,
     0.91,
     0.8,
     1
    ],
    "intensity": 1.45,
    "shadows": 2,
    "shadowStrength": 0.9
   },
   "sky": null,
   "lights": []
  },
  "weather": {
   "baseFogColor": [
    0.88,
    0.76,
    0.6,
    1
   ],
   "baseFogStart": 40,
   "baseFogEnd": 260,
   "theme": "Desert",
   "whiteoutProfile": "",
   "baseWind": 0.25,
   "region": {
    "name": "④ 驼队营地沙暴",
    "fade": 24,
    "profile": "sandstorm",
    "calm": 22,
    "warn": 7,
    "storm": 18,
    "abate": 6,
    "firstDelay": 6,
    "armRadius": 85,
    "loop": true
   }
  },
  "boundaryTuning": {
   "softStart": 0,
   "windRamp": 14,
   "pushBase": 4,
   "pushGain": 18,
   "hazeLead": 6,
   "failsafe": 26,
   "navInset": 2,
   "tetherSlack": 2,
   "tetherGrace": 1.2
  },
  "quicksand": null,
  "camp": null,
  "safeZone": null,
  "grade": {
   "Bloom": {
    "threshold": 1,
    "intensity": 0.496,
    "scatter": 0.65,
    "clamp": 65472,
    "tint": [
     1,
     0.9,
     0.78,
     1
    ],
    "highQualityFiltering": false,
    "filter": 0,
    "downscale": 0,
    "maxIterations": 6,
    "dirtIntensity": 0
   },
   "Tonemapping": {
    "mode": 1
   },
   "ColorAdjustments": {
    "postExposure": -0.919,
    "contrast": 24.4,
    "colorFilter": [
     1,
     1,
     1,
     1
    ],
    "hueShift": 0,
    "saturation": -11
   },
   "WhiteBalance": {
    "temperature": -9.5,
    "tint": -0.5
   },
   "LiftGammaGain": {
    "lift": [
     1,
     1,
     1,
     -0.007
    ],
    "gamma": [
     1,
     1,
     1,
     0.258
    ],
    "gain": [
     1,
     1,
     1,
     -0.084
    ]
   },
   "ShadowsMidtonesHighlights": {
    "shadows": [
     1,
     1,
     1,
     0
    ],
    "midtones": [
     1,
     1,
     1,
     0
    ],
    "highlights": [
     1,
     1,
     1,
     0
    ],
    "shadowsStart": 0,
    "shadowsEnd": 0.3,
    "highlightsStart": 0.55,
    "highlightsEnd": 1
   },
   "Vignette": {
    "color": [
     0,
     0,
     0,
     1
    ],
    "center": [
     0.5,
     0.5
    ],
    "intensity": 0.276,
    "smoothness": 0.45,
    "rounded": false
   },
   "ChromaticAberration": {
    "intensity": 0
   },
   "FirstPersonExposure": {
    "multiplier": 2.755,
    "gamma": 1.2,
    "effects": 1.3,
    "effectsSaturation": 1.15,
    "flash": 1
   }
  }
 },
 "1-2": {
  "title": "雅丹迷城",
  "encounters": [
   {
    "title": "北河道 · 狮身背后",
    "optional": true,
    "requires": [],
    "reward": "",
    "chestOffset": [
     0,
     0,
     0
    ],
    "difficulty": 0,
    "triggerRadius": 9,
    "arenaRadius": 14,
    "entryDepth": 2,
    "requireSight": true,
    "autoTrigger": true,
    "roadside": true,
    "roles": [
     0,
     0,
     0,
     0
    ],
    "lanes": [
     0,
     0,
     0,
     0
    ],
    "waves": [
     {
      "label": "北河道 · 狮身背后",
      "hint": "狮身雅丹背后蹲着一队沙匪——先点掉蝎卫",
      "triggerRemaining": 1,
      "delay": 1.6,
      "entries": [
       {
        "enemy": "jerboa_blade",
        "count": 3,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 1
       },
       {
        "enemy": "scorpion_archer",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 1
       }
      ]
     }
    ]
   },
   {
    "title": "供养窟守军",
    "optional": true,
    "requires": [],
    "reward": "",
    "chestOffset": [
     0,
     0,
     0
    ],
    "difficulty": 0,
    "triggerRadius": 14,
    "arenaRadius": 16,
    "entryDepth": 2,
    "requireSight": true,
    "autoTrigger": false,
    "roadside": false,
    "roles": [
     2,
     3,
     0
    ],
    "lanes": [
     1,
     0,
     2
    ],
    "waves": [
     {
      "label": "供养窟守军",
      "hint": "",
      "triggerRemaining": 1,
      "delay": 1.6,
      "entries": [
       {
        "enemy": "jerboa_blade",
        "count": 2,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "scorpion_archer",
        "count": 1,
        "elite": true,
        "affix": "swift",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "fire_rat",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       }
      ]
     }
    ]
   },
   {
    "title": "塔尖广场",
    "optional": false,
    "requires": [],
    "reward": "weapon:min=1",
    "chestOffset": [
     0,
     0,
     0
    ],
    "difficulty": 0,
    "triggerRadius": 24,
    "arenaRadius": 30,
    "entryDepth": 2,
    "requireSight": true,
    "autoTrigger": true,
    "roadside": false,
    "roles": [
     1,
     2,
     2,
     3,
     6,
     5
    ],
    "lanes": [
     0,
     1,
     2,
     0,
     0,
     0
    ],
    "waves": [
     {
      "label": "镇墓",
      "hint": "镇墓兽正面格挡——绕到背后打裂缝",
      "triggerRemaining": 1,
      "delay": 1.6,
      "entries": [
       {
        "enemy": "tomb_beast",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "jerboa_blade",
        "count": 3,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "scorpion_archer",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       }
      ]
     },
     {
      "label": "塔前混编",
      "hint": "精英镇墓兽带护盾——先打琵琶，别站在蜃楼蟾的落点",
      "triggerRemaining": 1,
      "delay": 2,
      "entries": [
       {
        "enemy": "tomb_beast",
        "count": 1,
        "elite": true,
        "affix": "shielded",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "mirage_toad",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "apsara",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "jerboa_blade",
        "count": 2,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       }
      ]
     }
    ]
   },
   {
    "title": "中河道 · 汇流口",
    "optional": true,
    "requires": [],
    "reward": "",
    "chestOffset": [
     0,
     0,
     0
    ],
    "difficulty": 0,
    "triggerRadius": 9,
    "arenaRadius": 14,
    "entryDepth": 2,
    "requireSight": true,
    "autoTrigger": true,
    "roadside": true,
    "roles": [
     0,
     0,
     0,
     0
    ],
    "lanes": [
     0,
     0,
     0,
     0
    ],
    "waves": [
     {
      "label": "中河道 · 汇流口",
      "hint": "蜃楼蟾在河道里吊射——先打真身",
      "triggerRemaining": 1,
      "delay": 1.6,
      "entries": [
       {
        "enemy": "mirage_toad",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 1
       },
       {
        "enemy": "jerboa_blade",
        "count": 2,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 1
       },
       {
        "enemy": "scorpion_archer",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 1
       }
      ]
     }
    ]
   },
   {
    "title": "河口三叉",
    "optional": false,
    "requires": [],
    "reward": "weapon",
    "chestOffset": [
     0,
     0,
     0
    ],
    "difficulty": 0,
    "triggerRadius": 22,
    "arenaRadius": 30,
    "entryDepth": 2,
    "requireSight": true,
    "autoTrigger": true,
    "roadside": false,
    "roles": [
     2,
     2,
     3,
     3,
     0,
     2
    ],
    "lanes": [
     1,
     2,
     0,
     0,
     0,
     2
    ],
    "waves": [
     {
      "label": "河口伏击",
      "hint": "跳鼠从两侧河道的缺口包抄——背靠岩丘、守住缺口",
      "triggerRemaining": 1,
      "delay": 1.6,
      "entries": [
       {
        "enemy": "jerboa_blade",
        "count": 3,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "scorpion_archer",
        "count": 2,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       }
      ]
     },
     {
      "label": "侧河道包抄",
      "hint": "跳鼠从低雅丹顶上跳下来，火浣鼠滚过来会炸——上河心洲拉开距离",
      "triggerRemaining": 1,
      "delay": 1.6,
      "entries": [
       {
        "enemy": "jerboa_blade",
        "count": 3,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 5
       },
       {
        "enemy": "fire_rat",
        "count": 2,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       }
      ]
     }
    ]
   },
   {
    "title": "屋脊之海",
    "optional": false,
    "requires": [],
    "reward": "scroll",
    "chestOffset": [
     0,
     0,
     0
    ],
    "difficulty": 0,
    "triggerRadius": 22,
    "arenaRadius": 30,
    "entryDepth": 2,
    "requireSight": true,
    "autoTrigger": true,
    "roadside": false,
    "roles": [
     2,
     2,
     3,
     6,
     0
    ],
    "lanes": [
     1,
     2,
     0,
     0,
     0
    ],
    "waves": [
     {
      "label": "沙下的街",
      "hint": "流沙会往下拖，沙魇从沙里钻出来——从积沙坡上屋顶走",
      "triggerRemaining": 1,
      "delay": 1.6,
      "entries": [
       {
        "enemy": "fire_rat",
        "count": 3,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "sand_wraith",
        "count": 2,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "apsara",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       }
      ]
     },
     {
      "label": "飞天降临",
      "hint": "先打飞天的琵琶，她在给同伴加护",
      "triggerRemaining": 1,
      "delay": 2,
      "entries": [
       {
        "enemy": "apsara",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "fire_rat",
        "count": 2,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "scorpion_archer",
        "count": 2,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       }
      ]
     }
    ]
   },
   {
    "title": "岩拱门",
    "optional": false,
    "requires": [],
    "reward": "upgrade",
    "chestOffset": [
     0,
     0,
     0
    ],
    "difficulty": 0,
    "triggerRadius": 20,
    "arenaRadius": 24,
    "entryDepth": 2,
    "requireSight": true,
    "autoTrigger": true,
    "roadside": false,
    "roles": [
     1,
     3,
     2,
     2,
     5
    ],
    "lanes": [
     0,
     0,
     1,
     2,
     0
    ],
    "waves": [
     {
      "label": "守门小队",
      "hint": "拱门下是唯一的出路——先清岩台上的弩卫",
      "triggerRemaining": 1,
      "delay": 1.6,
      "entries": [
       {
        "enemy": "scorpion_archer",
        "count": 2,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "jerboa_blade",
        "count": 3,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "fire_rat",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "mirage_toad",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       }
      ]
     }
    ]
   },
   {
    "title": "南河道 · 汇流前",
    "optional": true,
    "requires": [],
    "reward": "",
    "chestOffset": [
     0,
     0,
     0
    ],
    "difficulty": 0,
    "triggerRadius": 9,
    "arenaRadius": 14,
    "entryDepth": 2,
    "requireSight": true,
    "autoTrigger": true,
    "roadside": true,
    "roles": [
     0,
     0,
     0,
     0
    ],
    "lanes": [
     0,
     0,
     0,
     0
    ],
    "waves": [
     {
      "label": "南河道 · 汇流前",
      "hint": "沙魇伏在河道沙里——脚下亮圈就跑开",
      "triggerRemaining": 1,
      "delay": 1.6,
      "entries": [
       {
        "enemy": "jerboa_blade",
        "count": 2,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 1
       },
       {
        "enemy": "sand_wraith",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 1
       },
       {
        "enemy": "scorpion_archer",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 1
       }
      ]
     }
    ]
   },
   {
    "title": "南河道 · 缺口",
    "optional": true,
    "requires": [],
    "reward": "",
    "chestOffset": [
     0,
     0,
     0
    ],
    "difficulty": 0,
    "triggerRadius": 9,
    "arenaRadius": 14,
    "entryDepth": 2,
    "requireSight": true,
    "autoTrigger": true,
    "roadside": true,
    "roles": [
     0,
     0,
     0,
     0
    ],
    "lanes": [
     0,
     0,
     0,
     0
    ],
    "waves": [
     {
      "label": "南河道 · 缺口",
      "hint": "火浣鼠会顺河道滚过来——拉开距离",
      "triggerRemaining": 1,
      "delay": 1.6,
      "entries": [
       {
        "enemy": "fire_rat",
        "count": 2,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 1
       },
       {
        "enemy": "jerboa_blade",
        "count": 2,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 1
       }
      ]
     }
    ]
   }
  ],
  "caches": [
   {
    "title": "供养窟",
    "reward": "pet",
    "guard": "供养窟守军"
   },
   {
    "title": "商队遗物",
    "reward": "coins",
    "guard": null
   }
  ],
  "bosses": [],
  "environment": {
   "fog": {
    "enabled": true,
    "mode": 1,
    "color": [
     0.88,
     0.76,
     0.6,
     1
    ],
    "start": 60,
    "end": 360,
    "density": 0.01
   },
   "ambient": {
    "mode": 1,
    "sky": [
     0.44,
     0.52,
     0.7,
     1
    ],
    "equator": [
     0.58,
     0.5,
     0.42,
     1
    ],
    "ground": [
     0.34,
     0.27,
     0.21,
     1
    ],
    "light": [
     0.44,
     0.52,
     0.7,
     1
    ],
    "intensity": 1
   },
   "sun": {
    "forward": [
     -0.6861,
     -0.5878,
     0.4287
    ],
    "color": [
     1,
     0.91,
     0.8,
     1
    ],
    "intensity": 1.45,
    "shadows": 2,
    "shadowStrength": 0.9
   },
   "sky": null,
   "lights": []
  },
  "weather": {
   "baseFogColor": [
    0.88,
    0.76,
    0.6,
    1
   ],
   "baseFogStart": 60,
   "baseFogEnd": 360,
   "theme": "Desert",
   "whiteoutProfile": "",
   "baseWind": 0.3,
   "region": null
  },
  "boundaryTuning": {
   "softStart": 0,
   "windRamp": 14,
   "pushBase": 4,
   "pushGain": 18,
   "hazeLead": 6,
   "failsafe": 26,
   "navInset": 2,
   "tetherSlack": 2,
   "tetherGrace": 1.2
  },
  "quicksand": {
   "radius": 4.5,
   "coreRadius": 1.8,
   "pullEdge": 1.2,
   "pullCore": 4.5,
   "slowEdge": 0.7,
   "slowCore": 0.3,
   "sinkTime": 2.2,
   "burst": 0.08,
   "above": 0.8,
   "below": 1.5,
   "surface": true
  },
  "camp": null,
  "safeZone": null,
  "grade": {
   "Bloom": {
    "threshold": 1,
    "intensity": 0.496,
    "scatter": 0.65,
    "clamp": 65472,
    "tint": [
     1,
     0.9,
     0.78,
     1
    ],
    "highQualityFiltering": false,
    "filter": 0,
    "downscale": 0,
    "maxIterations": 6,
    "dirtIntensity": 0
   },
   "Tonemapping": {
    "mode": 1
   },
   "ColorAdjustments": {
    "postExposure": -0.919,
    "contrast": 24.4,
    "colorFilter": [
     1,
     1,
     1,
     1
    ],
    "hueShift": 0,
    "saturation": -11
   },
   "WhiteBalance": {
    "temperature": -9.5,
    "tint": -0.5
   },
   "LiftGammaGain": {
    "lift": [
     1,
     1,
     1,
     -0.007
    ],
    "gamma": [
     1,
     1,
     1,
     0.258
    ],
    "gain": [
     1,
     1,
     1,
     -0.084
    ]
   },
   "ShadowsMidtonesHighlights": {
    "shadows": [
     1,
     1,
     1,
     0
    ],
    "midtones": [
     1,
     1,
     1,
     0
    ],
    "highlights": [
     1,
     1,
     1,
     0
    ],
    "shadowsStart": 0,
    "shadowsEnd": 0.3,
    "highlightsStart": 0.55,
    "highlightsEnd": 1
   },
   "Vignette": {
    "color": [
     0,
     0,
     0,
     1
    ],
    "center": [
     0.5,
     0.5
    ],
    "intensity": 0.276,
    "smoothness": 0.45,
    "rounded": false
   },
   "ChromaticAberration": {
    "intensity": 0
   },
   "FirstPersonExposure": {
    "multiplier": 2.755,
    "gamma": 1.2,
    "effects": 1.3,
    "effectsSaturation": 1.15,
    "flash": 1
   }
  }
 },
 "1-3": {
  "title": "沉沙古城",
  "encounters": [
   {
    "title": "灌沙城门",
    "optional": false,
    "requires": [],
    "reward": "scroll",
    "chestOffset": [
     0,
     0,
     0
    ],
    "difficulty": 0,
    "triggerRadius": 20,
    "arenaRadius": 26,
    "entryDepth": 2,
    "requireSight": true,
    "autoTrigger": true,
    "roadside": false,
    "roles": [
     2,
     1,
     1,
     3
    ],
    "lanes": [
     0,
     1,
     0,
     2
    ],
    "waves": [
     {
      "label": "灌沙伏击",
      "hint": "跳鼠、沙魇从沙坡两翼扑上来，墙头有弩卫",
      "triggerRemaining": 1,
      "delay": 1.6,
      "entries": [
       {
        "enemy": "jerboa_blade",
        "count": 2,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "sand_wraith",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "scorpion_archer",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       }
      ]
     },
     {
      "label": "沙坡滚火",
      "hint": "火浣鼠顺坡滚下，往高处让开",
      "triggerRemaining": 1,
      "delay": 1.6,
      "entries": [
       {
        "enemy": "fire_rat",
        "count": 2,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "jerboa_blade",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       }
      ]
     }
    ]
   },
   {
    "title": "寺院前庭",
    "optional": false,
    "requires": [],
    "reward": "weapon:min=1",
    "chestOffset": [
     0,
     0,
     0
    ],
    "difficulty": 0,
    "triggerRadius": 24,
    "arenaRadius": 30,
    "entryDepth": 2,
    "requireSight": true,
    "autoTrigger": true,
    "roadside": false,
    "roles": [
     1,
     1,
     2,
     2,
     3,
     3,
     6,
     2
    ],
    "lanes": [
     0,
     1,
     1,
     2,
     0,
     1,
     0,
     1
    ],
    "waves": [
     {
      "label": "前庭守卫",
      "hint": "跳鼠从西回廊二层跳下来，镇墓兽正面格挡——绕到背后打裂缝",
      "triggerRemaining": 1,
      "delay": 1.6,
      "entries": [
       {
        "enemy": "tomb_beast",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "jerboa_blade",
        "count": 2,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 5
       },
       {
        "enemy": "scorpion_archer",
        "count": 2,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       }
      ]
     },
     {
      "label": "飞天赐福",
      "hint": "先打飞天的琵琶，再清火浣鼠",
      "triggerRemaining": 2,
      "delay": 1.6,
      "entries": [
       {
        "enemy": "apsara",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "fire_rat",
        "count": 3,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "mirage_toad",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       }
      ]
     },
     {
      "label": "沙王卫队",
      "hint": "精英卫队——巨像台上有俯射位",
      "triggerRemaining": 1,
      "delay": 2,
      "entries": [
       {
        "enemy": "tomb_beast",
        "count": 1,
        "elite": true,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "scorpion_archer",
        "count": 1,
        "elite": true,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "jerboa_blade",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "sand_wraith",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       }
      ]
     }
    ]
   },
   {
    "title": "三路长街",
    "optional": false,
    "requires": [],
    "reward": "weapon",
    "chestOffset": [
     0,
     0,
     -8
    ],
    "difficulty": 0,
    "triggerRadius": 22,
    "arenaRadius": 30,
    "entryDepth": 2,
    "requireSight": true,
    "autoTrigger": true,
    "roadside": false,
    "roles": [
     1,
     1,
     3,
     3,
     2,
     6,
     2
    ],
    "lanes": [
     0,
     1,
     0,
     1,
     2,
     1,
     1
    ],
    "waves": [
     {
      "label": "长街伏兵",
      "hint": "弩卫在沙台和墙头，走马道绕上去",
      "triggerRemaining": 1,
      "delay": 1.6,
      "entries": [
       {
        "enemy": "jerboa_blade",
        "count": 3,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "scorpion_archer",
        "count": 2,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       }
      ]
     },
     {
      "label": "墙头与屋檐",
      "hint": "跳鼠从北墙墙头跳下沙台，镇墓兽顺街冲锋——上沙台躲开，先打飞天的琵琶",
      "triggerRemaining": 1,
      "delay": 1.6,
      "entries": [
       {
        "enemy": "tomb_beast",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "apsara",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "jerboa_blade",
        "count": 2,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 5
       }
      ]
     }
    ]
   },
   {
    "title": "埋屋守军",
    "optional": true,
    "requires": [],
    "reward": "",
    "chestOffset": [
     0,
     0,
     0
    ],
    "difficulty": 0,
    "triggerRadius": 16,
    "arenaRadius": 22,
    "entryDepth": 2,
    "requireSight": true,
    "autoTrigger": false,
    "roadside": false,
    "roles": [
     3,
     2,
     1
    ],
    "lanes": [
     0,
     1,
     2
    ],
    "waves": [
     {
      "label": "埋屋守军",
      "hint": "守着藏宝的一小队，埋屋的沙里还伏着沙魇",
      "triggerRemaining": 1,
      "delay": 1.6,
      "entries": [
       {
        "enemy": "scorpion_archer",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "jerboa_blade",
        "count": 2,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "sand_wraith",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       }
      ]
     }
    ]
   },
   {
    "title": "井台东南 · 巷子",
    "optional": true,
    "requires": [],
    "reward": "",
    "chestOffset": [
     0,
     0,
     0
    ],
    "difficulty": 0,
    "triggerRadius": 9,
    "arenaRadius": 14,
    "entryDepth": 2,
    "requireSight": true,
    "autoTrigger": true,
    "roadside": true,
    "roles": [
     0,
     0,
     0,
     0
    ],
    "lanes": [
     0,
     0,
     0,
     0
    ],
    "waves": [
     {
      "label": "井台东南 · 巷子",
      "hint": "巷子里的火浣鼠会滚出来——别在窄处被堵",
      "triggerRemaining": 1,
      "delay": 1.6,
      "entries": [
       {
        "enemy": "fire_rat",
        "count": 2,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 1
       },
       {
        "enemy": "jerboa_blade",
        "count": 2,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 1
       },
       {
        "enemy": "mirage_toad",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 1
       }
      ]
     }
    ]
   },
   {
    "title": "商铺台北口",
    "optional": true,
    "requires": [],
    "reward": "",
    "chestOffset": [
     0,
     0,
     0
    ],
    "difficulty": 0,
    "triggerRadius": 9,
    "arenaRadius": 14,
    "entryDepth": 2,
    "requireSight": true,
    "autoTrigger": true,
    "roadside": true,
    "roles": [
     0,
     0,
     0,
     0
    ],
    "lanes": [
     0,
     0,
     0,
     0
    ],
    "waves": [
     {
      "label": "商铺台北口",
      "hint": "商铺台下蹲着一队沙匪——先点掉蝎卫",
      "triggerRemaining": 1,
      "delay": 1.6,
      "entries": [
       {
        "enemy": "jerboa_blade",
        "count": 3,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 1
       },
       {
        "enemy": "scorpion_archer",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 1
       }
      ]
     }
    ]
   },
   {
    "title": "屋顶沙台 · 东段",
    "optional": true,
    "requires": [],
    "reward": "",
    "chestOffset": [
     0,
     0,
     0
    ],
    "difficulty": 0,
    "triggerRadius": 9,
    "arenaRadius": 14,
    "entryDepth": 2,
    "requireSight": true,
    "autoTrigger": true,
    "roadside": true,
    "roles": [
     0,
     0,
     0,
     0
    ],
    "lanes": [
     0,
     0,
     0,
     0
    ],
    "waves": [
     {
      "label": "屋顶沙台 · 东段",
      "hint": "蝎卫守在沙台上——从巷口坡道摸上去",
      "triggerRemaining": 1,
      "delay": 1.6,
      "entries": [
       {
        "enemy": "scorpion_archer",
        "count": 2,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 1
       },
       {
        "enemy": "jerboa_blade",
        "count": 2,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 1
       }
      ]
     }
    ]
   },
   {
    "title": "西坊 · 沙扇脚巷口",
    "optional": true,
    "requires": [],
    "reward": "",
    "chestOffset": [
     0,
     0,
     0
    ],
    "difficulty": 0,
    "triggerRadius": 9,
    "arenaRadius": 14,
    "entryDepth": 2,
    "requireSight": true,
    "autoTrigger": true,
    "roadside": true,
    "roles": [
     0,
     0,
     0,
     0
    ],
    "lanes": [
     0,
     0,
     0,
     0
    ],
    "waves": [
     {
      "label": "西坊 · 沙扇脚巷口",
      "hint": "沙扇脚下伏着一队——沙魇在沙里，脚下亮圈就跑开",
      "triggerRemaining": 1,
      "delay": 1.6,
      "entries": [
       {
        "enemy": "jerboa_blade",
        "count": 3,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 1
       },
       {
        "enemy": "sand_wraith",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 1
       }
      ]
     }
    ]
   },
   {
    "title": "集市井台",
    "optional": false,
    "requires": [],
    "reward": "scroll",
    "chestOffset": [
     0,
     0,
     -8
    ],
    "difficulty": 0,
    "triggerRadius": 22,
    "arenaRadius": 28,
    "entryDepth": 2,
    "requireSight": true,
    "autoTrigger": true,
    "roadside": false,
    "roles": [
     1,
     2,
     5,
     5,
     2,
     3
    ],
    "lanes": [
     0,
     1,
     1,
     0,
     2,
     2
    ],
    "waves": [
     {
      "label": "井台蜃影",
      "hint": "蜃楼蟾在井沿上吊射，分身打不坏真身",
      "triggerRemaining": 1,
      "delay": 1.6,
      "entries": [
       {
        "enemy": "mirage_toad",
        "count": 2,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "jerboa_blade",
        "count": 3,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       }
      ]
     },
     {
      "label": "集市乱战",
      "hint": "火浣鼠滚进井底，上台阶或坡道",
      "triggerRemaining": 1,
      "delay": 1.6,
      "entries": [
       {
        "enemy": "fire_rat",
        "count": 3,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "jerboa_blade",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "scorpion_archer",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       }
      ]
     }
    ]
   }
  ],
  "caches": [
   {
    "title": "墙头藏宝",
    "reward": "upgrade",
    "guard": null
   },
   {
    "title": "埋屋藏宝",
    "reward": "weapon:min=1",
    "guard": "埋屋守军"
   }
  ],
  "bosses": [],
  "environment": {
   "fog": {
    "enabled": true,
    "mode": 1,
    "color": [
     0.88,
     0.76,
     0.6,
     1
    ],
    "start": 40,
    "end": 260,
    "density": 0.01
   },
   "ambient": {
    "mode": 1,
    "sky": [
     0.44,
     0.52,
     0.7,
     1
    ],
    "equator": [
     0.58,
     0.5,
     0.42,
     1
    ],
    "ground": [
     0.34,
     0.27,
     0.21,
     1
    ],
    "light": [
     0.44,
     0.52,
     0.7,
     1
    ],
    "intensity": 1
   },
   "sun": {
    "forward": [
     -0.6861,
     -0.5878,
     0.4287
    ],
    "color": [
     1,
     0.91,
     0.8,
     1
    ],
    "intensity": 1.45,
    "shadows": 2,
    "shadowStrength": 0.9
   },
   "sky": null,
   "lights": []
  },
  "weather": {
   "baseFogColor": [
    0.88,
    0.76,
    0.6,
    1
   ],
   "baseFogStart": 40,
   "baseFogEnd": 260,
   "theme": "Desert",
   "whiteoutProfile": "",
   "baseWind": 0.3,
   "region": null
  },
  "boundaryTuning": {
   "softStart": 0,
   "windRamp": 14,
   "pushBase": 4,
   "pushGain": 18,
   "hazeLead": 6,
   "failsafe": 26,
   "navInset": 2,
   "tetherSlack": 2,
   "tetherGrace": 1.2
  },
  "quicksand": null,
  "camp": {
   "safeRadius": 10,
   "openShop": true,
   "restoreOnArrive": false
  },
  "safeZone": {
   "radius": 10,
   "height": 6,
   "pushMargin": 1.5,
   "carveNavMesh": true
  },
  "grade": {
   "Bloom": {
    "threshold": 1,
    "intensity": 0.496,
    "scatter": 0.65,
    "clamp": 65472,
    "tint": [
     1,
     0.9,
     0.78,
     1
    ],
    "highQualityFiltering": false,
    "filter": 0,
    "downscale": 0,
    "maxIterations": 6,
    "dirtIntensity": 0
   },
   "Tonemapping": {
    "mode": 1
   },
   "ColorAdjustments": {
    "postExposure": -0.919,
    "contrast": 24.4,
    "colorFilter": [
     1,
     1,
     1,
     1
    ],
    "hueShift": 0,
    "saturation": -11
   },
   "WhiteBalance": {
    "temperature": -9.5,
    "tint": -0.5
   },
   "LiftGammaGain": {
    "lift": [
     1,
     1,
     1,
     -0.007
    ],
    "gamma": [
     1,
     1,
     1,
     0.258
    ],
    "gain": [
     1,
     1,
     1,
     -0.084
    ]
   },
   "ShadowsMidtonesHighlights": {
    "shadows": [
     1,
     1,
     1,
     0
    ],
    "midtones": [
     1,
     1,
     1,
     0
    ],
    "highlights": [
     1,
     1,
     1,
     0
    ],
    "shadowsStart": 0,
    "shadowsEnd": 0.3,
    "highlightsStart": 0.55,
    "highlightsEnd": 1
   },
   "Vignette": {
    "color": [
     0,
     0,
     0,
     1
    ],
    "center": [
     0.5,
     0.5
    ],
    "intensity": 0.276,
    "smoothness": 0.45,
    "rounded": false
   },
   "ChromaticAberration": {
    "intensity": 0
   },
   "FirstPersonExposure": {
    "multiplier": 2.755,
    "gamma": 1.2,
    "effects": 1.3,
    "effectsSaturation": 1.15,
    "flash": 1
   }
  }
 },
 "1-4": {
  "title": "鸣沙山月牙泉 · 旱魃",
  "encounters": [],
  "caches": [],
  "bosses": [
   {
    "id": "boss_hanba",
    "radius": 44
   }
  ],
  "environment": {
   "fog": {
    "enabled": true,
    "mode": 1,
    "color": [
     0.88,
     0.76,
     0.6,
     1
    ],
    "start": 70,
    "end": 420,
    "density": 0.01
   },
   "ambient": {
    "mode": 1,
    "sky": [
     0.44,
     0.52,
     0.7,
     1
    ],
    "equator": [
     0.58,
     0.5,
     0.42,
     1
    ],
    "ground": [
     0.34,
     0.27,
     0.21,
     1
    ],
    "light": [
     0.44,
     0.52,
     0.7,
     1
    ],
    "intensity": 1
   },
   "sun": {
    "forward": [
     -0.7568,
     -0.515,
     0.4024
    ],
    "color": [
     1,
     0.87,
     0.7,
     1
    ],
    "intensity": 1.595,
    "shadows": 2,
    "shadowStrength": 1
   },
   "sky": null,
   "lights": []
  },
  "weather": {
   "baseFogColor": [
    0.88,
    0.76,
    0.6,
    1
   ],
   "baseFogStart": 70,
   "baseFogEnd": 420,
   "theme": "Desert",
   "whiteoutProfile": "",
   "baseWind": 0.25,
   "region": null
  },
  "boundaryTuning": {
   "softStart": 0,
   "windRamp": 14,
   "pushBase": 4,
   "pushGain": 18,
   "hazeLead": 6,
   "failsafe": 26,
   "navInset": 2,
   "tetherSlack": 2,
   "tetherGrace": 1.2
  },
  "quicksand": null,
  "camp": null,
  "safeZone": {
   "radius": 11,
   "height": 6,
   "pushMargin": 1.5,
   "carveNavMesh": true
  },
  "grade": {
   "Bloom": {
    "threshold": 1,
    "intensity": 0.496,
    "scatter": 0.65,
    "clamp": 65472,
    "tint": [
     1,
     0.9,
     0.78,
     1
    ],
    "highQualityFiltering": false,
    "filter": 0,
    "downscale": 0,
    "maxIterations": 6,
    "dirtIntensity": 0
   },
   "Tonemapping": {
    "mode": 1
   },
   "ColorAdjustments": {
    "postExposure": -0.919,
    "contrast": 24.4,
    "colorFilter": [
     1,
     1,
     1,
     1
    ],
    "hueShift": 0,
    "saturation": -11
   },
   "WhiteBalance": {
    "temperature": -9.5,
    "tint": -0.5
   },
   "LiftGammaGain": {
    "lift": [
     1,
     1,
     1,
     -0.007
    ],
    "gamma": [
     1,
     1,
     1,
     0.258
    ],
    "gain": [
     1,
     1,
     1,
     -0.084
    ]
   },
   "ShadowsMidtonesHighlights": {
    "shadows": [
     1,
     1,
     1,
     0
    ],
    "midtones": [
     1,
     1,
     1,
     0
    ],
    "highlights": [
     1,
     1,
     1,
     0
    ],
    "shadowsStart": 0,
    "shadowsEnd": 0.3,
    "highlightsStart": 0.55,
    "highlightsEnd": 1
   },
   "Vignette": {
    "color": [
     0,
     0,
     0,
     1
    ],
    "center": [
     0.5,
     0.5
    ],
    "intensity": 0.276,
    "smoothness": 0.45,
    "rounded": false
   },
   "ChromaticAberration": {
    "intensity": 0
   },
   "FirstPersonExposure": {
    "multiplier": 2.755,
    "gamma": 1.2,
    "effects": 1.3,
    "effectsSaturation": 1.15,
    "flash": 1
   }
  }
 },
 "1-A": {
  "title": "千佛崖",
  "encounters": [
   {
    "title": "崖顶塔院",
    "optional": false,
    "requires": [],
    "reward": "weapon:min=1",
    "chestOffset": [
     0,
     0,
     0
    ],
    "difficulty": 0,
    "triggerRadius": 24,
    "arenaRadius": 30,
    "entryDepth": 2,
    "requireSight": true,
    "autoTrigger": true,
    "roadside": false,
    "roles": [
     1,
     1,
     2,
     2,
     3,
     3,
     5,
     6
    ],
    "lanes": [
     0,
     1,
     1,
     2,
     0,
     1,
     0,
     0
    ],
    "waves": [
     {
      "label": "塔院守卫",
      "hint": "镇墓兽正面格挡——上塔基台绕到它背后",
      "triggerRemaining": 1,
      "delay": 1.6,
      "entries": [
       {
        "enemy": "tomb_beast",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "jerboa_blade",
        "count": 3,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "scorpion_archer",
        "count": 2,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": 1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       }
      ]
     },
     {
      "label": "飞天赐福",
      "hint": "先打飞天的琵琶，再清火浣鼠",
      "triggerRemaining": 2,
      "delay": 1.6,
      "entries": [
       {
        "enemy": "apsara",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 4
       },
       {
        "enemy": "fire_rat",
        "count": 3,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "mirage_toad",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": 1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       }
      ]
     },
     {
      "label": "千佛护法",
      "hint": "精英护法——塔基台上有俯射位",
      "triggerRemaining": 1,
      "delay": 2,
      "entries": [
       {
        "enemy": "tomb_beast",
        "count": 1,
        "elite": true,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "scorpion_archer",
        "count": 1,
        "elite": true,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "jerboa_blade",
        "count": 2,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "sand_wraith",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       }
      ]
     }
    ]
   },
   {
    "title": "大佛窟前",
    "optional": false,
    "requires": [],
    "reward": "weapon",
    "chestOffset": [
     0,
     0,
     -8
    ],
    "difficulty": 0,
    "triggerRadius": 22,
    "arenaRadius": 30,
    "entryDepth": 2,
    "requireSight": true,
    "autoTrigger": true,
    "roadside": false,
    "roles": [
     1,
     2,
     2,
     1,
     3,
     3,
     1,
     2,
     5,
     6
    ],
    "lanes": [
     0,
     1,
     2,
     1,
     0,
     1,
     0,
     2,
     0,
     0
    ],
    "waves": [
     {
      "label": "窟前伏兵",
      "hint": "蝎卫在窟檐层上压制：贴着崖脚的回廊推进",
      "triggerRemaining": 1,
      "delay": 1.6,
      "entries": [
       {
        "enemy": "jerboa_blade",
        "count": 4,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "scorpion_archer",
        "count": 2,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": 1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       }
      ]
     },
     {
      "label": "佛前蜃影",
      "hint": "蜃楼蟾在广场边吊射，火浣鼠滚进来逼走位",
      "triggerRemaining": 2,
      "delay": 1.4,
      "entries": [
       {
        "enemy": "mirage_toad",
        "count": 2,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "fire_rat",
        "count": 3,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": 0.8,
        "lane": -1,
        "holdBack": true,
        "via": 0
       }
      ]
     },
     {
      "label": "飞天护法",
      "hint": "飞天从崖顶飞下来、跳鼠从窟檐层跃下——先打飞天的琵琶",
      "triggerRemaining": 1,
      "delay": 1.8,
      "entries": [
       {
        "enemy": "apsara",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 4
       },
       {
        "enemy": "jerboa_blade",
        "count": 2,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 5
       },
       {
        "enemy": "sand_wraith",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       }
      ]
     }
    ]
   },
   {
    "title": "河床伏兵",
    "optional": true,
    "requires": [],
    "reward": "",
    "chestOffset": [
     0,
     0,
     0
    ],
    "difficulty": 0,
    "triggerRadius": 12,
    "arenaRadius": 16,
    "entryDepth": 2,
    "requireSight": true,
    "autoTrigger": true,
    "roadside": true,
    "roles": [
     1,
     2,
     1
    ],
    "lanes": [
     0,
     1,
     2
    ],
    "waves": [
     {
      "label": "河床伏兵",
      "hint": "干河床里趴着一小队——先手打掉火浣鼠",
      "triggerRemaining": 1,
      "delay": 1.6,
      "entries": [
       {
        "enemy": "jerboa_blade",
        "count": 2,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 1
       },
       {
        "enemy": "fire_rat",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 1
       }
      ]
     }
    ]
   },
   {
    "title": "窟檐拐角",
    "optional": true,
    "requires": [],
    "reward": "",
    "chestOffset": [
     0,
     0,
     0
    ],
    "difficulty": 0,
    "triggerRadius": 12,
    "arenaRadius": 16,
    "entryDepth": 2,
    "requireSight": true,
    "autoTrigger": true,
    "roadside": true,
    "roles": [
     1,
     3,
     2
    ],
    "lanes": [
     0,
     1,
     2
    ],
    "waves": [
     {
      "label": "窟檐拐角",
      "hint": "窟檐层拐角后面守着一队",
      "triggerRemaining": 1,
      "delay": 1.6,
      "entries": [
       {
        "enemy": "jerboa_blade",
        "count": 2,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 1
       },
       {
        "enemy": "scorpion_archer",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 1
       }
      ]
     }
    ]
   },
   {
    "title": "下寺遗址",
    "optional": true,
    "requires": [],
    "reward": "",
    "chestOffset": [
     0,
     0,
     0
    ],
    "difficulty": 0,
    "triggerRadius": 12,
    "arenaRadius": 16,
    "entryDepth": 2,
    "requireSight": true,
    "autoTrigger": true,
    "roadside": true,
    "roles": [
     1,
     2,
     5
    ],
    "lanes": [
     0,
     1,
     0
    ],
    "waves": [
     {
      "label": "下寺遗址",
      "hint": "蜃楼蟾蹲在屋脊后面",
      "triggerRemaining": 1,
      "delay": 1.6,
      "entries": [
       {
        "enemy": "jerboa_blade",
        "count": 2,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 1
       },
       {
        "enemy": "mirage_toad",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 1
       }
      ]
     }
    ]
   },
   {
    "title": "遗骸守军",
    "optional": true,
    "requires": [],
    "reward": "",
    "chestOffset": [
     0,
     0,
     0
    ],
    "difficulty": 0,
    "triggerRadius": 14,
    "arenaRadius": 20,
    "entryDepth": 2,
    "requireSight": true,
    "autoTrigger": false,
    "roadside": false,
    "roles": [
     3,
     2,
     2,
     1
    ],
    "lanes": [
     0,
     1,
     2,
     0
    ],
    "waves": [
     {
      "label": "遗骸守军",
      "hint": "守着驼队遗骸的一小队，沙里还伏着沙魇",
      "triggerRemaining": 1,
      "delay": 1.6,
      "entries": [
       {
        "enemy": "scorpion_archer",
        "count": 1,
        "elite": true,
        "affix": "swift",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "jerboa_blade",
        "count": 3,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "sand_wraith",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       }
      ]
     }
    ]
   },
   {
    "title": "崖顶伏兵",
    "optional": true,
    "requires": [],
    "reward": "",
    "chestOffset": [
     0,
     0,
     0
    ],
    "difficulty": 0,
    "triggerRadius": 12,
    "arenaRadius": 16,
    "entryDepth": 2,
    "requireSight": true,
    "autoTrigger": true,
    "roadside": true,
    "roles": [
     3,
     1,
     3
    ],
    "lanes": [
     0,
     1,
     2
    ],
    "waves": [
     {
      "label": "崖顶伏兵",
      "hint": "崖顶上的弩卫——贴着斜道口的崖壁打",
      "triggerRemaining": 1,
      "delay": 1.6,
      "entries": [
       {
        "enemy": "scorpion_archer",
        "count": 2,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 1
       },
       {
        "enemy": "jerboa_blade",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 1
       }
      ]
     }
    ]
   },
   {
    "title": "西崖窟檐",
    "optional": false,
    "requires": [],
    "reward": "scroll",
    "chestOffset": [
     0,
     0,
     0
    ],
    "difficulty": 0,
    "triggerRadius": 20,
    "arenaRadius": 28,
    "entryDepth": 2,
    "requireSight": true,
    "autoTrigger": true,
    "roadside": false,
    "roles": [
     1,
     1,
     1,
     2,
     2,
     3,
     3,
     5,
     6
    ],
    "lanes": [
     0,
     1,
     0,
     1,
     1,
     2,
     0,
     0,
     0
    ],
    "waves": [
     {
      "label": "栈道守卫",
      "hint": "窟檐层上近身，崖脚和崖顶都有弩卫——借回廊的柱子挡",
      "triggerRemaining": 1,
      "delay": 1.6,
      "entries": [
       {
        "enemy": "jerboa_blade",
        "count": 3,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "scorpion_archer",
        "count": 2,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": 1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       }
      ]
     },
     {
      "label": "崖顶跃下",
      "hint": "跳鼠从崖顶跳下来，火浣鼠顺着窟檐层滚——跳下崖脚躲开也行",
      "triggerRemaining": 2,
      "delay": 1.4,
      "entries": [
       {
        "enemy": "jerboa_blade",
        "count": 2,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 5
       },
       {
        "enemy": "fire_rat",
        "count": 3,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": 0.6,
        "lane": -1,
        "holdBack": true,
        "via": 0
       }
      ]
     },
     {
      "label": "飞天赐福",
      "hint": "蜃楼蟾在崖脚吊射窟檐层：别贴着栏墙站，先打飞天",
      "triggerRemaining": 1,
      "delay": 1.6,
      "entries": [
       {
        "enemy": "apsara",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 4
       },
       {
        "enemy": "sand_wraith",
        "count": 2,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "mirage_toad",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       }
      ]
     }
    ]
   },
   {
    "title": "河洲驼队",
    "optional": false,
    "requires": [],
    "reward": "upgrade",
    "chestOffset": [
     0,
     0,
     0
    ],
    "difficulty": 0,
    "triggerRadius": 22,
    "arenaRadius": 30,
    "entryDepth": 2,
    "requireSight": true,
    "autoTrigger": true,
    "roadside": false,
    "roles": [
     1,
     1,
     2,
     2,
     3,
     3,
     1,
     5,
     6
    ],
    "lanes": [
     0,
     1,
     1,
     2,
     0,
     1,
     1,
     0,
     0
    ],
    "waves": [
     {
      "label": "驼队残兵",
      "hint": "沙洲上的残车是掩体，两岸有弩卫",
      "triggerRemaining": 1,
      "delay": 1.6,
      "entries": [
       {
        "enemy": "jerboa_blade",
        "count": 3,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "scorpion_archer",
        "count": 2,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": 1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "fire_rat",
        "count": 2,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": 1.4,
        "lane": -1,
        "holdBack": true,
        "via": 0
       }
      ]
     },
     {
      "label": "河床伏沙",
      "hint": "镇墓兽顺河床冲过来：侧闪，打背后的裂缝；飞天从北岸飞来",
      "triggerRemaining": 2,
      "delay": 1.6,
      "entries": [
       {
        "enemy": "sand_wraith",
        "count": 2,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "tomb_beast",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": -1,
        "lane": -1,
        "holdBack": true,
        "via": 0
       },
       {
        "enemy": "jerboa_blade",
        "count": 2,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": 0.8,
        "lane": -1,
        "holdBack": true,
        "via": 5
       },
       {
        "enemy": "apsara",
        "count": 1,
        "elite": false,
        "affix": "",
        "role": 0,
        "arrivalDelay": 1.2,
        "lane": -1,
        "holdBack": true,
        "via": 4
       }
      ]
     }
    ]
   }
  ],
  "caches": [
   {
    "title": "藏经洞",
    "reward": "scroll",
    "guard": null
   },
   {
    "title": "河滩遗骸",
    "reward": "weapon:min=1",
    "guard": "遗骸守军"
   }
  ],
  "bosses": [],
  "environment": {
   "fog": {
    "enabled": true,
    "mode": 1,
    "color": [
     0.88,
     0.76,
     0.6,
     1
    ],
    "start": 70,
    "end": 420,
    "density": 0.01
   },
   "ambient": {
    "mode": 1,
    "sky": [
     0.44,
     0.52,
     0.7,
     1
    ],
    "equator": [
     0.58,
     0.5,
     0.42,
     1
    ],
    "ground": [
     0.34,
     0.27,
     0.21,
     1
    ],
    "light": [
     0.44,
     0.52,
     0.7,
     1
    ],
    "intensity": 1
   },
   "sun": {
    "forward": [
     -0.6861,
     -0.5878,
     0.4287
    ],
    "color": [
     1,
     0.91,
     0.8,
     1
    ],
    "intensity": 1.45,
    "shadows": 2,
    "shadowStrength": 0.9
   },
   "sky": null,
   "lights": []
  },
  "weather": {
   "baseFogColor": [
    0.88,
    0.76,
    0.6,
    1
   ],
   "baseFogStart": 70,
   "baseFogEnd": 420,
   "theme": "Desert",
   "whiteoutProfile": "",
   "baseWind": 0.3,
   "region": null
  },
  "boundaryTuning": {
   "softStart": 0,
   "windRamp": 14,
   "pushBase": 4,
   "pushGain": 18,
   "hazeLead": 6,
   "failsafe": 26,
   "navInset": 2,
   "tetherSlack": 2,
   "tetherGrace": 1.2
  },
  "quicksand": null,
  "camp": null,
  "safeZone": null,
  "grade": {
   "Bloom": {
    "threshold": 1,
    "intensity": 0.496,
    "scatter": 0.65,
    "clamp": 65472,
    "tint": [
     1,
     0.9,
     0.78,
     1
    ],
    "highQualityFiltering": false,
    "filter": 0,
    "downscale": 0,
    "maxIterations": 6,
    "dirtIntensity": 0
   },
   "Tonemapping": {
    "mode": 1
   },
   "ColorAdjustments": {
    "postExposure": -0.919,
    "contrast": 24.4,
    "colorFilter": [
     1,
     1,
     1,
     1
    ],
    "hueShift": 0,
    "saturation": -11
   },
   "WhiteBalance": {
    "temperature": -9.5,
    "tint": -0.5
   },
   "LiftGammaGain": {
    "lift": [
     1,
     1,
     1,
     -0.007
    ],
    "gamma": [
     1,
     1,
     1,
     0.258
    ],
    "gain": [
     1,
     1,
     1,
     -0.084
    ]
   },
   "ShadowsMidtonesHighlights": {
    "shadows": [
     1,
     1,
     1,
     0
    ],
    "midtones": [
     1,
     1,
     1,
     0
    ],
    "highlights": [
     1,
     1,
     1,
     0
    ],
    "shadowsStart": 0,
    "shadowsEnd": 0.3,
    "highlightsStart": 0.55,
    "highlightsEnd": 1
   },
   "Vignette": {
    "color": [
     0,
     0,
     0,
     1
    ],
    "center": [
     0.5,
     0.5
    ],
    "intensity": 0.276,
    "smoothness": 0.45,
    "rounded": false
   },
   "ChromaticAberration": {
    "intensity": 0
   },
   "FirstPersonExposure": {
    "multiplier": 2.755,
    "gamma": 1.2,
    "effects": 1.3,
    "effectsSaturation": 1.15,
    "flash": 1
   }
  }
 }
} as unknown as Record<string, MapPlay>;
