namespace Spiritfire.Game
{
    /// <summary>
    /// 磐 · 工匠武僧（Three.js 版 src/player/skills/bear.ts 的 BEAR，穿山甲美术）：生命 140 / 护盾 80 / 移速 7.0 / 减伤 10%，初始碎岩霰弹。
    /// 被动「厚皮」、E 裂地重击、Q 磐石壁垒，数值见 <see cref="BearSkills"/>。
    /// </summary>
    [Defs(2)]
    public sealed class Hero_Bear : HeroDef
    {
        public Hero_Bear()
        {
            id = "bear";
            name = "磐";
            title = "工匠武僧";
            description = "修了一辈子山门石阶的穿山甲武僧，慢吞吞、推不动，一身鳞甲就是最好的盾。生命与护盾冠绝众人，并天生减免 10% 伤害；" +
                          "扛着钻炮霰弹走进人堆，一拳裂地把敌人震上半空，是队伍里那座山。";
            color = Hex.Rgb(0xc9a36b);
            maxHp = 140;
            maxShield = 80;
            moveSpeed = 7.0f;
            baseStats = new[] { (Stat.DamageReduction, 0.1f) };
            armR = "SM_Arms_PangolinR";
            armL = "SM_Arms_PangolinL";
            startWeapon = "shotgun";
            role = "近战坦克";
            difficulty = 1;
            tags = new[] { "护盾", "控制", "霰弹" };
            tip = "顶在前线，用磐石壁垒扛住首领大招";
            passiveName = "厚皮";
            passiveDescription = $"护盾恢复延迟缩短 1 秒；护盾被击破时释放震地冲击波，对 {BearSkills.HideWaveRadius} 米内敌人造成 {BearSkills.HideWaveDamage} 点伤害并将其击退" +
                                 $"（内置冷却 {BearSkills.HideWaveIcd} 秒）。";
        }

        public override Skill CreatePrimary() => new BearBastion();
        public override Skill CreateSecondary() => new BearEarthSplitter();
        public override IHeroPassive CreatePassive() => new BearThickHide();
    }
}
