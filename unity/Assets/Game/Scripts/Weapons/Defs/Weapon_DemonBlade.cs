using System.Collections.Generic;

namespace Spiritfire.Game
{
    /// <summary>
    /// 碎刃（TS demon_blade，原名魔刀千刃；D7：第 18 把，掉落权重 0.6，完整移植）。没有弹药与换弹：左键三段斩、右键千刃出窍、R 碎刃屏障、
    /// V / 中键杀气爆发（杀意满时人刀合一），被动噬灵鬼眼。玩法参数见 <see cref="DemonBladeDef.CreateSpec"/>，整帧由 <see cref="DemonBladeController"/> 接管。
    /// 根字段 = 千刃出窍的一次结算（每 0.1 秒 6 点，单体 60 秒伤），供描述、词条换算（meleeHitScale）与秒伤基准；mag 1 只为不触发应急补给。
    /// 模型是程序化的碎片 + 设计图刀柄贴图（WC5 BladeMeshBaker 烘出 SK_Weapon_DemonBlade）；第一人称在 WC7 之前用占位视图。
    /// </summary>
    [Defs(170)]
    public sealed class Weapon_DemonBlade : IDefSource<WeaponDef>
    {
        public IEnumerable<WeaponDef> Create()
        {
            yield return new WeaponDef
            {
                id = DemonBladeDef.WeaponId, name = "碎刃", category = "刀", kind = WeaponKind.Blade, prefab = BladeModel.PrefabId,
                mode = FireMode.Auto, reload = ReloadStyle.Box, sfx = "blade_swing", sfxVolume = 0.7f,
                damage = 6, fireRate = 10, mag = 1, reserve = 0, reloadTime = 0,
                spreadTs = new SpreadParams(0, 0, 0, 0, 0),
                critMult = 2, range = 22, pierce = 0,
                element = Element.None, elementChance = 0.35f, aimFov = 0,
                knockback = 0, kickBack = 0, kickRot = 0, shake = 0, flash = 0, tracerWidth = 0, impactSize = 0.6f,
                // 第一人称由接管者自己摆（占位视图 / WC7 BladeView），rig 枢轴留在相机原点
                viewHip = WeaponDef.View(0, 0, 0), viewAim = WeaponDef.View(0, 0, 0),
                worldScale = 1.3f, dropWeight = 0.6f,
                blade = DemonBladeDef.CreateSpec(),
                description = "百余片陨铁碎刃以灵火相系，合则为刀，散则为雨，绞杀之后自行归位；刀根封着一只鬼眼，以亡者魂力为食。",
                notes = new[]
                {
                    "左键「斩」：三段连斩，第三段伸刃横扫 6 米；斩中回复刃气",
                    "右键按住「千刃出窍」：整把刀化作刃群追着准星绞杀，无视敌人护盾；松开归刀",
                    "R 按住「碎刃屏障」：碎片在身前结成圆盾，挡下敌方弹道",
                    "V「杀气爆发」：碎片聚于一点后炸开；杀意满时变为「人刀合一」",
                    "噬灵鬼眼：用碎刃击杀时刀根睁眼，吸取魂力回复生命",
                },
            };
        }
    }
}
