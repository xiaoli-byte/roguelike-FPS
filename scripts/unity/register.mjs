// node --import ./scripts/unity/register.mjs <脚本>：启用 ts-hooks（直接 import 游戏 TS 源码）
import { register } from 'node:module';

register('./ts-hooks.mjs', import.meta.url);
