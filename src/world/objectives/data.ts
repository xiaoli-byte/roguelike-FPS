/**
 * 各关的关卡目标数据：灵火坛（M 座里点亮 N 座）、首领据点（4-1 三领主）、必清 / 可选场地。类型和用法见 LevelObjectives.ts。
 *
 * 2026-11-26 从 Unity 场景导出的 objectives.json 一次性转来（只去掉了来源字段 scene），之后这里就是唯一来源，直接改这张表。
 *   · 走关卡目标的只有 4-1（6 座灵火坛点亮 3 座；化蛇 / 飞廉 / 夔三个据点领主点亮 ④⑤⑥）和 4-3（5 座点亮 3 座）；
 *     其余关 altarsNeeded = 0、没有据点首领，照旧终点战清关（required / optional 只是场地名单）。
 *   · 坐标和关卡场景文档同一个坐标系（网页坐标）；场地名 = 场景文档里遭遇的 title；
 *     门槛圆 threshold = 据点首领的触发范围（圆心 / 半径 / 脚的高度范围）。
 * 写成 TS 模块而不是 JSON：node --test 的加载器不认不带 import attribute 的 JSON。
 */
import type { LevelObjectivesDoc } from './LevelObjectives';

export const LEVEL_OBJECTIVES: Readonly<Record<string, LevelObjectivesDoc>> = {
  '1-1': {
    objective: {
      title: '穿越古道',
      altarsNeeded: 0,
      autoCollect: false,
      required: ['黑戈壁砾石滩', '雅丹石阵', '烽燧台地', '驼队残骸营地'],
      optional: ['商队遗货守军'],
      altars: [],
    },
    altars: [],
    bosses: [],
  },
  '1-2': {
    objective: {
      title: '穿越雅丹迷城',
      altarsNeeded: 0,
      autoCollect: false,
      required: ['河口三叉', '屋脊之海', '塔尖广场', '岩拱门'],
      optional: ['供养窟守军'],
      altars: [],
    },
    altars: [],
    bosses: [],
  },
  '1-3': {
    objective: {
      title: '穿过沉沙古城',
      altarsNeeded: 0,
      autoCollect: false,
      required: ['灌沙城门', '三路长街', '集市井台', '寺院前庭'],
      optional: ['埋屋守军'],
      altars: [],
    },
    altars: [],
    bosses: [],
  },
  '2-1': {
    objective: {
      title: '登上瀑顶冰潭',
      altarsNeeded: 0,
      autoCollect: false,
      required: ['冰河', '东岸台地', '冰桥', '冰柱林', '瀑顶冰潭'],
      optional: ['驿亭守军'],
      altars: [],
    },
    altars: [],
    bosses: [],
  },
  '2-2': {
    objective: {
      title: '叩开天阙',
      altarsNeeded: 0,
      autoCollect: false,
      required: ['玉阶月台', '九门外庭', '开明兽庭', '玉京殿前'],
      optional: ['玉库守军'],
      altars: [],
    },
    altars: [],
    bosses: [],
  },
  '2-3': {
    objective: {
      title: '渡过瑶池',
      altarsNeeded: 0,
      autoCollect: false,
      required: ['湖心冰光', '西岸祭坛', '东岸船坞', '瑶台'],
      optional: ['冻船伏兵'],
      altars: [],
    },
    altars: [],
    bosses: [],
  },
  '3-1': {
    objective: {
      title: '破熔湖关隘',
      altarsNeeded: 0,
      autoCollect: false,
      required: ['渡口关楼', '税关墩', '锚链大墩', '宫门瓮城'],
      optional: ['熔铸遗址守军'],
      altars: [],
    },
    altars: [],
    bosses: [],
  },
  '3-2': {
    objective: {
      title: '下到铸神井底',
      altarsNeeded: 0,
      autoCollect: false,
      required: ['炮工坊窟', '悬炉锻台', '风箱窟', '熔泉炉坛'],
      optional: ['铸范库守军'],
      altars: [],
    },
    altars: [],
    bosses: [],
  },
  '3-3': {
    objective: {
      title: '肃清铸范大坊',
      altarsNeeded: 0,
      autoCollect: false,
      required: ['范场', '浇包吊坊', '鼓风正殿', '鼓风正殿 · 炉门守军', '神范前庭'],
      optional: ['废范守军'],
      altars: [],
    },
    altars: [],
    bosses: [
      {
        bossId: 'boss_warlord',
        stronghold: false,
        enabled: false,
        altar: null,
        rewardPoint: [-166, -0.0009, 192],
        thresholdInset: 2,
        tetherSlack: 8,
        warnSeconds: 2.5,
        warnText: '神范台的熔铜沸腾了——熔心魔将自神范中醒来！',
      },
    ],
  },
  '3-4': {
    objective: {
      title: '肃清祝融神道',
      altarsNeeded: 0,
      autoCollect: false,
      required: ['铜人神道', '熔流闸口'],
      optional: [],
      altars: [],
    },
    altars: [],
    bosses: [
      {
        bossId: 'boss_qilin',
        stronghold: false,
        enabled: false,
        altar: null,
        rewardPoint: [0, 0.0002, -12],
        thresholdInset: 2.5,
        tetherSlack: 6,
        warnSeconds: 2.5,
        warnText: '熔池翻涌、熔铁闸落——火麒麟自炉心跃出！',
      },
    ],
  },
  '4-1': {
    objective: {
      title: '点亮三处灵火 · 开垭口',
      altarsNeeded: 3,
      autoCollect: false,
      required: [],
      optional: ['碉楼寨兽群', '白塔溪谷兽群', '牧民营地兽群', '圣湖岸兽群', '冰川口兽群', '经幡山头兽群', '垭口守卫'],
      altars: ['Altar_1_s1', 'Altar_2_s2', 'Altar_3_s3', 'Altar_4_s4', 'Altar_5_s5', 'Altar_6_s6'],
    },
    altars: [
      { name: 'Altar_1_s1', title: '灵火坛 · ① 碉楼寨', position: [188, 27.0944, 38], yaw: -153.43, guard: '碉楼寨兽群', lightOnGuardCleared: false, kindleTime: 1.2, healOnLight: true },
      { name: 'Altar_2_s2', title: '灵火坛 · ② 白塔溪谷', position: [18, 7.51, -60], yaw: 108.43, guard: '白塔溪谷兽群', lightOnGuardCleared: false, kindleTime: 1.2, healOnLight: true },
      { name: 'Altar_3_s3', title: '灵火坛 · ③ 牧民营地', position: [-140, 11.7678, -132], yaw: 0, guard: '牧民营地兽群', lightOnGuardCleared: false, kindleTime: 1.2, healOnLight: true },
      { name: 'Altar_4_s4', title: '灵火坛 · ④ 圣湖海子', position: [96, 9.0042, 144], yaw: 84.14, guard: null, lightOnGuardCleared: false, kindleTime: 1.2, healOnLight: true },
      { name: 'Altar_5_s5', title: '灵火坛 · ⑤ 冰川口', position: [-64, 23.946, 178], yaw: 70.02, guard: null, lightOnGuardCleared: false, kindleTime: 1.2, healOnLight: true },
      { name: 'Altar_6_s6', title: '灵火坛 · ⑥ 经幡山头', position: [-82, 49.0615, 62], yaw: -45, guard: null, lightOnGuardCleared: false, kindleTime: 1.2, healOnLight: true },
    ],
    bosses: [
      {
        bossId: 'boss_huashe',
        stronghold: true,
        enabled: true,
        altar: 'Altar_4_s4',
        rewardPoint: [98.9843, 9.0042, 144.3061],
        thresholdInset: 53,
        tetherSlack: 30,
        warnSeconds: 2.5,
        warnText: '圣湖的水面起了涟漪，一道长长的黑影在水下游过……',
        threshold: { center: [140, 9.9639, 150], radius: 50, minY: 2.9639, maxY: 24.4141 },
      },
      {
        bossId: 'boss_feilian',
        stronghold: true,
        enabled: true,
        altar: 'Altar_5_s5',
        rewardPoint: [-61.1806, 23.946, 179.0252],
        thresholdInset: 35,
        tetherSlack: 30,
        warnSeconds: 2.5,
        warnText: '冰舌顶上的风涡收紧了——风伯飞廉！',
        threshold: { center: [-40, 37.8338, 228], radius: 32, minY: 15.2113, maxY: 48.9011 },
      },
      {
        bossId: 'boss_kui',
        stronghold: true,
        enabled: true,
        altar: 'Altar_6_s6',
        rewardPoint: [-84.1213, 49.0615, 64.1213],
        thresholdInset: 33,
        tetherSlack: 30,
        warnSeconds: 2.5,
        warnText: '乌云从经幡山头压了过来——残鼓在震！',
        threshold: { center: [-115, 48.3135, 61], radius: 22, minY: 32.9072, maxY: 57.516 },
      },
    ],
  },
  '4-3': {
    objective: {
      title: '点亮三处灵火 · 开谷口',
      altarsNeeded: 3,
      autoCollect: false,
      required: [],
      optional: ['东岸塌方兽群', '北岸金林兽群', '西岸霜滩兽群', '玛尼石滩兽群', '猎人营地兽群', '谷口守卫'],
      altars: ['Altar_1_s1', 'Altar_2_s2', 'Altar_3_s3', 'Altar_4_s4', 'Altar_5_s5'],
    },
    altars: [
      { name: 'Altar_1_s1', title: '灵火坛 · ① 东岸塌方', position: [-170, 1.5479, 52], yaw: -50.71, guard: '东岸塌方兽群', lightOnGuardCleared: false, kindleTime: 1.2, healOnLight: true },
      { name: 'Altar_2_s2', title: '灵火坛 · ② 北岸金林', position: [8, 0.6665, 100], yaw: 23.2, guard: '北岸金林兽群', lightOnGuardCleared: false, kindleTime: 1.2, healOnLight: true },
      { name: 'Altar_3_s3', title: '灵火坛 · ③ 西岸霜滩', position: [198, 0.6434, -44], yaw: 13.57, guard: '西岸霜滩兽群', lightOnGuardCleared: false, kindleTime: 1.2, healOnLight: true },
      { name: 'Altar_4_s4', title: '灵火坛 · ④ 玛尼石滩', position: [58, 15.3952, 312], yaw: 43.36, guard: '玛尼石滩兽群', lightOnGuardCleared: false, kindleTime: 1.2, healOnLight: true },
      { name: 'Altar_5_s5', title: '灵火坛 · ⑤ 南坡猎人营地', position: [-66, 3.5195, -236], yaw: -143.62, guard: '猎人营地兽群', lightOnGuardCleared: false, kindleTime: 1.2, healOnLight: true },
    ],
    bosses: [],
  },
  '1-A': {
    objective: {
      title: '穿过千佛崖',
      altarsNeeded: 0,
      autoCollect: false,
      required: ['大佛窟前', '西崖窟檐', '崖顶塔院', '河洲驼队'],
      optional: ['遗骸守军'],
      altars: [],
    },
    altars: [],
    bosses: [],
  },
  '2-A': {
    objective: {
      title: '穿过玄冰裂谷',
      altarsNeeded: 0,
      autoCollect: false,
      required: ['冰封角楼', '冰塔林', '冰碛垄', '冰川源头'],
      optional: ['冰封经幡祠守军'],
      altars: [],
    },
    altars: [],
    bosses: [],
  },
  '3-A': {
    objective: {
      title: '穿越赤焰灰原',
      altarsNeeded: 0,
      autoCollect: false,
      required: ['玄武柱林', '火口丘', '祝融残殿', '熔渠铸坊'],
      optional: ['烬穴守军'],
      altars: [],
    },
    altars: [],
    bosses: [],
  },
};
