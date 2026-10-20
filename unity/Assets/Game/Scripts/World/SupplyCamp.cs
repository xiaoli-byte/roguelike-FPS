using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 首领前的补给营（docs/unity-parity.md 3.10 / 4.6 关卡场景标记「SupplyCamp」；Three.js StageDirector.setupBossSupply + boss-supply 测试）：
    /// 关卡构建器在首领场门槛外摆一个这个标记（1-3 寺院前庭、1-4 月牙泉入口、2-4 雪岭营地…），物体位置 = 营地中心（地面），朝向 = 商店正面（玩家走来的方向）。
    /// 开局时：
    ///   · 开一家完整的店（<see cref="Shop"/>：武器 ×2、秘卷、强化台、战备药剂、弹药箱）——回血回盾是付费服务（战备药剂），到达补给营不白给（同 TS：arrival does not freely restore health）；
    ///   · 立一块安全区（<see cref="SafeZone"/>）：敌人进不来，首领关的门槛在营地里不会触发（<see cref="BossEncounter"/>）；
    ///   · 营火 + 旗杆占位（4.11：关卡给了名为 Model 的美术子物体时不生成）；
    ///   · 玩家第一次走进营地时提示「{label} · 可购买武器、秘卷、强化与战备补给；进入主战区才会迎战首领」。
    /// 首领战中商店仍在，但附近有首领 / 敌人交战时拒绝一切交易（不能退回补给营边打边回血）。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class SupplyCamp : MonoBehaviour
    {
        [Tooltip("营地名（提示里用）")] public string label = "补给营";
        [Tooltip("安全区半径（米）：要盖住商店弧（6.4 m）和顾客站位")] public float safeRadius = 10f;
        [Tooltip("开局自动开店")] public bool openShop = true;
        [Tooltip("摊位 / 强化台美术（空 = 程序占位）")] public GameObject stallArt, benchArt;
        [Tooltip("到达补给营就回满（缺省关：回复是付费服务，同 Three.js）")] public bool restoreOnArrive;

        bool announced, built;

        public Shop Shop { get; private set; }
        public SafeZone Zone { get; private set; }

        void Start() => Build();

        /// <summary>开店、立安全区、摆营火（只做一次；套件运行时挂上后也可以直接调）</summary>
        public void Build()
        {
            if (built) return;
            built = true;
            Zone = GetComponent<SafeZone>();
            if (!Zone) Zone = gameObject.AddComponent<SafeZone>();
            Zone.radius = Mathf.Max(Zone.radius, safeRadius);
            Zone.PlayerInsideChanged += OnPlayerInside;
            if (openShop) Shop = Shop.Spawn(transform.position, transform.eulerAngles.y, null, transform, stallArt, benchArt);
            if (!PropBits.HasModel(transform)) BuildProps();
        }

        void OnDestroy()
        {
            if (Zone) Zone.PlayerInsideChanged -= OnPlayerInside;
            if (Shop) Shop.Close();
        }

        void OnPlayerInside(SafeZone z, bool inside)
        {
            if (!inside) return;
            if (restoreOnArrive)
            {
                var pv = PlayerVitals.Instance;
                if (pv && !pv.Dead)
                {
                    pv.Heal(pv.MaxHealth);
                    pv.AddShield(pv.MaxShield);
                }
            }
            if (announced) return;
            announced = true;
            GameUI.Toast($"{label} · 可购买武器、秘卷、强化与战备补给；进入主战区才会迎战首领", Hex.Rgb(0xa9dec7), 4f);
        }

        /// <summary>营火（石圈 + 发光火堆）与一根挂旗的旗杆，摆在商店弧的前方偏一侧，不挡顾客站位</summary>
        void BuildProps()
        {
            var root = new GameObject("Camp Props").transform;
            root.SetParent(transform, false);
            root.localPosition = new Vector3(2.6f, 0, 2.2f);
            root.position = Shop.Snap(root.position, transform.position.y);
            var stone = Hex.Rgb(0x8a8178);
            for (int i = 0; i < 7; i++)
            {
                float a = i * Mathf.PI * 2 / 7;
                PropBits.Box(root, "Stone", new Vector3(Mathf.Sin(a) * 0.55f, 0.1f, Mathf.Cos(a) * 0.55f), new Vector3(0.28f, 0.2f, 0.24f), stone);
            }
            var fire = PropBits.Box(root, "Embers", new Vector3(0, 0.12f, 0), new Vector3(0.5f, 0.14f, 0.5f), Hex.Rgb(0xff8a3a));
            fire.sharedMaterial = FxMaterials.Unlit;
            FxMaterials.Tint(fire, Hex.Rgb(0xff8a3a) * 1.8f);
            var glow = new GameObject("Glow").transform;
            glow.SetParent(root, false);
            glow.localPosition = new Vector3(0, 0.5f, 0);
            FxMaterials.GlowSprite(glow, 1.6f, new Color(1f, 0.55f, 0.2f, 0.55f));
            var pole = new GameObject("Banner Pole").transform;
            pole.SetParent(transform, false);
            pole.localPosition = new Vector3(-3.2f, 0, 2.6f);
            pole.position = Shop.Snap(pole.position, transform.position.y);
            PropBits.Box(pole, "Pole", new Vector3(0, 1.8f, 0), new Vector3(0.12f, 3.6f, 0.12f), Hex.Rgb(0x6b4128));
            PropBits.Box(pole, "Banner", new Vector3(0.45f, 2.9f, 0), new Vector3(0.8f, 1.1f, 0.03f), Hex.Rgb(0x2f8f6a));
        }
    }
}
