namespace Spiritfire.Game
{
    /// <summary>
    /// 鼯 · 雷鼓机关师（Three.js 版 src/player/skills/falcon.ts 的 FALCON，鼯鼠美术）：生命 90 / 护盾 70 / 移速 7.5 / 额外跳跃 1，初始赤铜左轮。
    /// 被动「凌空」（二段跳、滞空增伤 15%、滑翔）、E 雷鼓信标、Q 雷目·裁决，数值见 <see cref="FalconSkills"/>。
    /// </summary>
    [Defs(1)]
    public sealed class Hero_Falcon : HeroDef
    {
        public Hero_Falcon()
        {
            id = "falcon";
            name = "鼯";
            title = "雷鼓机关师";
            description = "墨家机关坊里最毛手毛脚的鼯鼠学徒，护腕线圈总在冒火花。二段跳加张膜滑翔让鼯始终占据高处，赤铜左轮弹无虚发；" +
                          "抛下雷鼓信标封锁敌群，开启雷目裁决时一枪连一雷，弹匣永不见底。";
            color = Hex.Rgb(0x6fd8ff);
            maxHp = 90;
            maxShield = 70;
            moveSpeed = 7.5f;
            baseStats = new[] { (Stat.ExtraJumps, 1f) };
            armR = "SM_Arms_FlyingSquirrelR";
            armL = "SM_Arms_FlyingSquirrelL";
            startWeapon = "revolver";
            role = "雷电机动";
            difficulty = 3;
            tags = new[] { "雷殛", "空战", "精准" };
            tip = "保持滞空：二段跳 + 滑翔时伤害更高";
            passiveName = "凌空";
            passiveDescription = $"可在空中额外跳跃 1 次；身处空中时造成的伤害提高 {FalconSkills.AirBonus * 100:F0}%；下落时按住跳跃键可张开飞膜滑翔，大幅减缓下落。";
        }

        public override Skill CreatePrimary() => new FalconHawkVerdict();
        public override Skill CreateSecondary() => new FalconStormBeacon();
        public override IHeroPassive CreatePassive() => new FalconSkyborne();
    }
}
