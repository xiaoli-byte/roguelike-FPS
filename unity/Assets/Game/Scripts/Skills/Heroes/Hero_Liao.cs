namespace Spiritfire.Game
{
    /// <summary>
    /// 燎 · 爆竹游侠（Three.js 版 src/player/skills/fox.ts 的 FOX，红熊猫美术）：生命 100 / 护盾 60 / 移速 7.8，初始蜂鸣冲锋枪。
    /// 被动「余烬」、E 燃爆雷、Q 尾焰火灵，数值见 <see cref="LiaoSkills"/>。
    /// </summary>
    [Defs(0)]
    public sealed class Hero_Liao : HeroDef
    {
        public Hero_Liao()
        {
            id = "fox";
            name = "燎";
            title = "爆竹游侠";
            description = "丝路上最爱显摆的小熊猫游侠，斜挎一排爆竹手雷，腰挂一盏火折子灯，玩火从不怕烫。冲锋枪一路压制，燃爆雷炸开成群的敌人，" +
                          "再甩尾放出追踪火灵收割——火烧得越旺，燎的枪口就越致命。";
            color = Hex.Rgb(0xff6a1f);
            maxHp = 100;
            maxShield = 60;
            moveSpeed = 7.8f;
            armR = "SM_Arms_RedPandaR";
            armL = "SM_Arms_RedPandaL";
            startWeapon = "smg";
            role = "火焰爆发";
            difficulty = 2;
            tags = new[] { "灼烧", "范围", "爆发" };
            tip = "先用燃爆雷点燃敌群，再借余烬被动收割";
            passiveName = "余烬";
            passiveDescription = $"对处于灼烧状态的敌人造成的所有伤害提高 {LiaoSkills.EmberBonus * 100:F0}%。";
        }

        public override Skill CreatePrimary() => new LiaoNineTails();
        public override Skill CreateSecondary() => new LiaoBlazeGrenade();
        public override IHeroPassive CreatePassive() => new LiaoEmber();
    }
}
