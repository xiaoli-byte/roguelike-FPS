using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.UI;

namespace Spiritfire.Game
{
    /// <summary>
    /// 战斗 HUD（Three.js 版 HUD / Crosshair / Notify / DamageNumbers 的切片版），全部用代码搭在一张 Canvas 上：
    ///   左下 护盾条（蓝）叠在生命条上 + 冲刺充能 · 右下 武器名（品质色）/ 弹匣 / 备弹 / 换弹进度
    ///   中央 随散布张开的准星、命中 / 暴击 / 击杀标记 · 受击方向指示 · 低血量红边与受击闪红
    ///   顶部 横幅（区域肃清、波次）与提示 · 右上 灵石数 · 屏幕下方 交互提示 · 伤害数字（世界坐标投影）· 阵亡画面
    ///   全屏闪光（<see cref="ScreenFlash"/>）与黑幕（<see cref="FadeTo"/>）
    /// Canvas 用 Screen Space - Camera 挂在主相机上，编辑器里的截图也能拍到 HUD。
    /// 玩法代码不直接找 Hud：走 <see cref="GameUI"/> 门面（U1 把后端换成 UI Toolkit 时调用方不用改）。
    /// 灵石在 <see cref="RunState"/> 里，<see cref="coins"/> / <see cref="AddCoins"/> 只是给旧调用方（冒烟测试）的转发。
    /// </summary>
    public sealed class Hud : MonoBehaviour
    {
        public static Hud Instance { get; private set; }

        public Camera cam;
        public PlayerVitals vitals;
        public WeaponController weapons;
        public PlayerMotor motor;

        Font font;
        RectTransform root;
        Image hpFill, hpTrail, shieldFill, vignette, hurtFlash, reloadFill, screenFlash, fade;
        Text hpText, weaponName, ammoText, reserveText, bannerText, toastText, coinText, promptText, stageText, deathText, objectiveText;
        RectTransform[] cross = new RectTransform[4];
        Image[] crossImg = new Image[4];
        RectTransform hitMarker;
        Image[] hitImg = new Image[4];
        RectTransform hurtArrow;
        Image hurtArrowImg;
        readonly List<Image> dashPips = new();
        float hitUntil, killUntil, bannerUntil, toastUntil, hurtArrowUntil, trail = 1;
        float flashUntil, flashTime = 1, fadeAlpha;
        int fadeToken;
        Color hitColor, toastColor = Color.white, flashColor;
        Vector3 hurtFrom;

        sealed class Number
        {
            public Text text;
            public Vector3 world, drift;
            public float life, max, scale;
            /// <summary>合并用：同一个目标、同一类（普通 / 持续）的数字在窗口内累加</summary>
            public Damageable target;
            public int kind;
            public float value, mergeUntil;
        }

        const float MergeWindow = 0.35f;

        readonly List<Number> numbers = new();
        /// <summary>本局灵石（转发 <see cref="RunState.coins"/>；旧 API，冒烟测试在读）</summary>
        public int coins => RunState.Current?.coins ?? 0;
        internal RectTransform Root => root;
        /// <summary>当前首领（<see cref="GameUI.SetBoss"/>；首领血条由 U3 接上，现在只记着）</summary>
        public Damageable Boss { get; private set; }
        public string BossTitle { get; private set; }

        void Awake()
        {
            Instance = this;
            // 打包的正文字体（Noto Sans SC 子集，导入设置里带余量做回退，D18）；没有时才退回系统字体（Deck / Linux 上会是豆腐块）
            font = UIFonts.Legacy;
            if (!font) font = Font.CreateDynamicFontFromOSFont(new[] { "Microsoft YaHei UI", "Microsoft YaHei", "SimHei", "Arial" }, 32);
            Build();
        }

        void OnEnable()
        {
            Combat.EnemyDamaged += OnEnemyDamaged;
            Combat.EnemyKilled += OnEnemyKilled;
            Combat.PlayerDamaged += OnPlayerDamaged;
        }

        void OnDisable()
        {
            Combat.EnemyDamaged -= OnEnemyDamaged;
            Combat.EnemyKilled -= OnEnemyKilled;
            Combat.PlayerDamaged -= OnPlayerDamaged;
        }

        // ───────────── 搭建 ─────────────
        void Build()
        {
            var canvasGo = new GameObject("HUD Canvas");
            canvasGo.transform.SetParent(transform, false);
            var canvas = canvasGo.AddComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceCamera;
            canvas.worldCamera = cam;
            canvas.planeDistance = 0.3f;
            canvas.sortingOrder = 10;
            var scaler = canvasGo.AddComponent<CanvasScaler>();
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(1920, 1080);
            scaler.matchWidthOrHeight = 1;
            root = canvasGo.GetComponent<RectTransform>();

            vignette = Img("Low HP", root, Vector2.zero, Vector2.one, Vector2.zero, Vector2.zero, new Color(0.7f, 0.05f, 0.02f, 0));
            vignette.sprite = VignetteSprite();
            hurtFlash = Img("Hurt Flash", root, Vector2.zero, Vector2.one, Vector2.zero, Vector2.zero, new Color(1f, 0.1f, 0.05f, 0));
            hurtFlash.sprite = vignette.sprite;

            // 左下：护盾 / 生命
            var vitalsBox = Rect("Vitals", root, new Vector2(0, 0), new Vector2(0, 0), new Vector2(60, 60), new Vector2(520, 130));
            Img("Shield BG", vitalsBox, new Vector2(0, 0.62f), new Vector2(1, 0.82f), Vector2.zero, Vector2.zero, new Color(0, 0, 0, 0.45f));
            shieldFill = Img("Shield", vitalsBox, new Vector2(0, 0.62f), new Vector2(1, 0.82f), Vector2.zero, Vector2.zero, new Color(0.45f, 0.78f, 1f, 0.95f));
            Img("HP BG", vitalsBox, new Vector2(0, 0.3f), new Vector2(1, 0.58f), Vector2.zero, Vector2.zero, new Color(0, 0, 0, 0.5f));
            hpTrail = Img("HP Trail", vitalsBox, new Vector2(0, 0.3f), new Vector2(1, 0.58f), Vector2.zero, Vector2.zero, new Color(1f, 0.85f, 0.6f, 0.8f));
            hpFill = Img("HP", vitalsBox, new Vector2(0, 0.3f), new Vector2(1, 0.58f), Vector2.zero, Vector2.zero, new Color(0.92f, 0.32f, 0.22f, 1f));
            hpText = Label("HP Text", vitalsBox, new Vector2(0, 0.86f), new Vector2(1, 1.25f), 30, TextAnchor.LowerLeft, Color.white);
            for (int i = 0; i < 3; i++)
            {
                var pip = Img($"Dash {i}", vitalsBox, new Vector2(0, 0), new Vector2(0, 0), new Vector2(i * 46, 0), new Vector2(i * 46 + 38, 18), new Color(1f, 0.9f, 0.6f));
                dashPips.Add(pip);
            }

            // 右下：武器与弹药
            var weaponBox = Rect("Weapon", root, new Vector2(1, 0), new Vector2(1, 0), new Vector2(-560, 60), new Vector2(-60, 200));
            weaponName = Label("Weapon Name", weaponBox, new Vector2(0, 0.66f), new Vector2(1, 1), 30, TextAnchor.LowerRight, Color.white);
            ammoText = Label("Ammo", weaponBox, new Vector2(0, 0.08f), new Vector2(0.78f, 0.7f), 76, TextAnchor.LowerRight, Color.white);
            reserveText = Label("Reserve", weaponBox, new Vector2(0.8f, 0.1f), new Vector2(1, 0.5f), 34, TextAnchor.LowerLeft, new Color(1, 1, 1, 0.7f));
            Img("Reload BG", weaponBox, new Vector2(0.3f, 0), new Vector2(1, 0.05f), Vector2.zero, Vector2.zero, new Color(0, 0, 0, 0.4f));
            reloadFill = Img("Reload", weaponBox, new Vector2(0.3f, 0), new Vector2(1, 0.05f), Vector2.zero, Vector2.zero, new Color(1f, 0.85f, 0.45f));
            // 填充条按 X 缩放，轴心放在左端
            foreach (var fill in new[] { hpFill, hpTrail, shieldFill, reloadFill }) fill.rectTransform.pivot = new Vector2(0, 0.5f);

            // 中央：准星
            for (int i = 0; i < 4; i++)
            {
                bool vertical = i % 2 == 0;
                var r = Rect($"Cross {i}", root, new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), Vector2.zero, Vector2.zero);
                r.sizeDelta = vertical ? new Vector2(3, 14) : new Vector2(14, 3);
                crossImg[i] = r.gameObject.AddComponent<Image>();
                crossImg[i].color = new Color(1, 1, 1, 0.9f);
                cross[i] = r;
            }
            var dot = Rect("Dot", root, new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), Vector2.zero, Vector2.zero);
            dot.sizeDelta = new Vector2(3, 3);
            dot.gameObject.AddComponent<Image>().color = new Color(1, 1, 1, 0.8f);
            hitMarker = Rect("Hit Marker", root, new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), Vector2.zero, Vector2.zero);
            for (int i = 0; i < 4; i++)
            {
                var r = Rect($"Hit {i}", hitMarker, new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), Vector2.zero, Vector2.zero);
                r.sizeDelta = new Vector2(3, 12);
                float ang = 45 + i * 90;
                r.localRotation = Quaternion.Euler(0, 0, ang);
                r.anchoredPosition = Quaternion.Euler(0, 0, ang) * new Vector2(0, 14);
                hitImg[i] = r.gameObject.AddComponent<Image>();
            }
            hurtArrow = Rect("Hurt Arrow", root, new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), Vector2.zero, Vector2.zero);
            var arrowBar = Rect("Arrow", hurtArrow, new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), new Vector2(-60, 150), new Vector2(60, 164));
            hurtArrowImg = arrowBar.gameObject.AddComponent<Image>();
            hurtArrowImg.color = new Color(1f, 0.2f, 0.1f, 0);

            // 顶部：横幅 / 提示 / 关卡名 / 灵石
            bannerText = Label("Banner", root, new Vector2(0, 0.74f), new Vector2(1, 0.84f), 64, TextAnchor.MiddleCenter, new Color(1f, 0.9f, 0.65f, 0));
            bannerText.gameObject.AddComponent<Outline>().effectColor = new Color(0, 0, 0, 0.6f);
            toastText = Label("Toast", root, new Vector2(0, 0.68f), new Vector2(1, 0.73f), 32, TextAnchor.MiddleCenter, new Color(1, 1, 1, 0));
            stageText = Label("Stage", root, new Vector2(0.6f, 0.92f), new Vector2(0.97f, 0.97f), 28, TextAnchor.MiddleRight, new Color(1, 1, 1, 0.85f));
            coinText = Label("Coins", root, new Vector2(0.6f, 0.87f), new Vector2(0.97f, 0.92f), 30, TextAnchor.MiddleRight, new Color(1f, 0.85f, 0.4f));
            objectiveText = Label("Objective", root, new Vector2(0.03f, 0.9f), new Vector2(0.5f, 0.95f), 30, TextAnchor.MiddleLeft, new Color(1f, 0.92f, 0.75f));
            objectiveText.gameObject.AddComponent<Outline>().effectColor = new Color(0, 0, 0, 0.6f);
            promptText = Label("Prompt", root, new Vector2(0, 0.3f), new Vector2(1, 0.36f), 32, TextAnchor.MiddleCenter, Color.white);
            promptText.gameObject.AddComponent<Outline>().effectColor = new Color(0, 0, 0, 0.7f);
            deathText = Label("Death", root, new Vector2(0, 0.4f), new Vector2(1, 0.62f), 72, TextAnchor.MiddleCenter, new Color(1f, 0.35f, 0.25f, 0));
            deathText.gameObject.AddComponent<Outline>().effectColor = new Color(0, 0, 0, 0.7f);

            // 全屏闪光 / 黑幕：平时全透明
            screenFlash = Img("Screen Flash", root, Vector2.zero, Vector2.one, Vector2.zero, Vector2.zero, new Color(1, 1, 1, 0));
            fade = Img("Fade", root, Vector2.zero, Vector2.one, Vector2.zero, Vector2.zero, new Color(0, 0, 0, 0));
            fade.enabled = false;
        }

        internal static RectTransform Rect(string name, Transform parent, Vector2 aMin, Vector2 aMax, Vector2 oMin, Vector2 oMax)
        {
            var go = new GameObject(name, typeof(RectTransform));
            var r = go.GetComponent<RectTransform>();
            r.SetParent(parent, false);
            r.anchorMin = aMin;
            r.anchorMax = aMax;
            r.offsetMin = oMin;
            r.offsetMax = oMax;
            return r;
        }

        internal static Image Img(string name, Transform parent, Vector2 aMin, Vector2 aMax, Vector2 oMin, Vector2 oMax, Color c)
        {
            var img = Rect(name, parent, aMin, aMax, oMin, oMax).gameObject.AddComponent<Image>();
            img.color = c;
            img.raycastTarget = false;
            return img;
        }

        internal Text Label(string name, Transform parent, Vector2 aMin, Vector2 aMax, int size, TextAnchor anchor, Color c)
        {
            var t = Rect(name, parent, aMin, aMax, Vector2.zero, Vector2.zero).gameObject.AddComponent<Text>();
            t.font = font;
            t.fontSize = size;
            t.alignment = anchor;
            t.color = c;
            t.raycastTarget = false;
            t.horizontalOverflow = HorizontalWrapMode.Overflow;
            t.verticalOverflow = VerticalWrapMode.Overflow;
            return t;
        }

        static Sprite VignetteSprite()
        {
            const int n = 128;
            var tex = new Texture2D(n, n, TextureFormat.RGBA32, false) { wrapMode = TextureWrapMode.Clamp };
            for (int y = 0; y < n; y++)
            for (int x = 0; x < n; x++)
            {
                float dx = (x + 0.5f) / n * 2 - 1, dy = (y + 0.5f) / n * 2 - 1;
                float d = Mathf.Sqrt(dx * dx * 0.7f + dy * dy * 0.9f);
                float a = Mathf.SmoothStep(0.55f, 1.15f, d);
                tex.SetPixel(x, y, new Color(1, 1, 1, a));
            }
            tex.Apply();
            return Sprite.Create(tex, new Rect(0, 0, n, n), new Vector2(0.5f, 0.5f));
        }

        // ───────────── 公共接口 ─────────────
        public void Banner(string text, float seconds = 2.5f)
        {
            bannerText.text = text;
            bannerUntil = Time.time + seconds;
        }

        /// <summary>单行提示；color = 文字颜色（缺省白色）</summary>
        public void Toast(string text, float seconds = 2.2f, Color? color = null)
        {
            toastText.text = text;
            toastUntil = Time.time + seconds;
            toastColor = color ?? Color.white;
        }

        /// <summary>弹出模态界面前收起横幅与提示</summary>
        public void ClearMessages()
        {
            bannerUntil = toastUntil = 0;
        }

        public void SetStage(string text) => stageText.text = text;
        public void SetObjective(string text) => objectiveText.text = text ?? "";
        public void SetPrompt(string text) => promptText.text = text ?? "";
        public void ShowDeath(string text) => deathText.text = text;

        /// <summary>交互提示卡 → 一行富文本：[键] 标题 副标题 价格，说明逐行跟在下面。只有标题时与旧的 SetPrompt(string) 完全一样</summary>
        public void SetPromptCard(InteractPrompt? card)
        {
            if (card == null)
            {
                promptText.text = "";
                return;
            }
            var p = card.Value;
            string title = p.color.a > 0 ? $"<color=#{ColorUtility.ToHtmlStringRGB(p.color)}>{p.title}</color>" : p.title;
            var sb = new System.Text.StringBuilder();
            sb.Append("<color=#ffd27a>[").Append(p.action ?? GameInput.BindingLabel(GameAction.Interact)).Append("]</color> ").Append(title);
            if (!string.IsNullOrEmpty(p.subtitle)) sb.Append(" <size=24><color=#e8e0d0>").Append(p.subtitle).Append("</color></size>");
            if (p.cost > 0) sb.Append(p.canAfford ? "　<color=#ffd98a>" : "　<color=#ff6a50>").Append("灵石 ").Append(p.cost).Append("</color>");
            if (p.lines != null)
                foreach (var line in p.lines)
                    if (!string.IsNullOrEmpty(line)) sb.Append("\n<size=24><color=#e8e0d0>").Append(line).Append("</color></size>");
            promptText.text = sb.ToString();
        }

        /// <summary>旧 API：进账灵石（转发 <see cref="RunState.Credit"/>）</summary>
        public void AddCoins(int n) => RunState.Ensure().Credit(n, "hud");

        /// <summary>全屏闪光：颜色（含 alpha）按剩余时间平方淡出，用不缩放时间（暂停中也会淡完）</summary>
        public void ScreenFlash(Color c, float seconds)
        {
            flashColor = c;
            flashTime = Mathf.Max(0.05f, seconds);
            flashUntil = Time.unscaledTime + flashTime;
            screenFlash.transform.SetAsLastSibling();
        }

        /// <summary>首领（null = 清掉）；U3 的首领血条读它</summary>
        public void SetBoss(Damageable boss, string title)
        {
            Boss = boss;
            BossTitle = boss ? title ?? boss.name : null;
        }

        /// <summary>全屏黑幕淡到 to（0 透明 → 1 全黑），用不缩放时间；新的淡入淡出会打断旧的</summary>
        public async Awaitable FadeTo(float to, float seconds)
        {
            int token = ++fadeToken;
            to = Mathf.Clamp01(to);
            float from = fadeAlpha, t = 0;
            fade.transform.SetAsLastSibling();
            while (t < seconds)
            {
                SetFade(Mathf.Lerp(from, to, t / seconds));
                await Awaitable.NextFrameAsync();
                if (!this || token != fadeToken) return;
                t += Time.unscaledDeltaTime;
            }
            SetFade(to);
        }

        void SetFade(float a)
        {
            fadeAlpha = a;
            fade.color = new Color(0, 0, 0, a);
            fade.enabled = a > 0;
        }

        // ───────────── 事件 ─────────────
        void OnEnemyDamaged(Damageable target, DamageInfo info, DamageResult r)
        {
            // 灵宠的命中照样出伤害数字，但不触发玩家的命中 / 击杀标记
            if (info.source != DamageSource.Status && info.source != DamageSource.Pet)
            {
                hitUntil = Time.time + 0.12f;
                hitColor = r.crit ? new Color(1f, 0.78f, 0.25f) : Color.white;
            }
            // 设置「伤害数字」关掉时只留命中标记（反应名等浮字不受影响）
            if (!GameSettings.DamageNumbers.Bool) return;
            Color c = r.immune ? new Color(0.7f, 0.7f, 0.7f)
                : r.layer == DamageLayer.Shield ? new Color(0.5f, 0.8f, 1f)
                : r.layer == DamageLayer.Armor ? new Color(1f, 0.85f, 0.35f)
                : info.element != Element.None ? DamageTable.ElementColor(info.element)
                : Color.white;
            if (r.crit && !r.immune) c = Color.Lerp(c, new Color(1f, 0.7f, 0.15f), 0.75f);
            float scale = r.crit ? 1.45f : info.reaction ? 1.15f : info.source == DamageSource.Status ? 0.75f : 1f;
            // 合并：普通命中 / 持续伤害在 0.35 s 内对同一个目标累加成一个数字（光束、冲锋枪不再刷屏）；暴击、反应、免疫、格挡单独弹
            int kind = r.crit || info.reaction || r.immune || r.blocked ? 0 : info.source == DamageSource.Status ? 2 : 1;
            if (kind != 0 && target)
                foreach (var n in numbers)
                    if (n.life > 0 && n.target == target && n.kind == kind && Time.time < n.mergeUntil)
                    {
                        n.value += r.total;
                        n.text.text = Mathf.Max(1, Mathf.RoundToInt(n.value)).ToString();
                        n.text.color = c;
                        n.world = info.point;
                        n.max = n.life = 0.85f;
                        n.mergeUntil = Time.time + MergeWindow;
                        // 越累越大一点，上限 1.6 倍
                        n.scale = Mathf.Min(scale * 1.6f, n.scale * 1.03f);
                        n.text.fontSize = Mathf.RoundToInt(34 * n.scale);
                        return;
                    }
            string s = r.immune ? "免疫" : r.blocked && r.total < 1 ? "格挡" : Mathf.Max(1, Mathf.RoundToInt(r.total)).ToString();
            var num = SpawnNumber(info.point, s, c, scale);
            num.target = kind != 0 ? target : null;
            num.kind = kind;
            num.value = r.total;
            num.mergeUntil = Time.time + MergeWindow;
        }

        void OnEnemyKilled(Damageable target, DamageInfo info)
        {
            // 灵宠的伤害（含它挂的元素烧死 / 反应炸死）不触发玩家的击杀标记
            if (info.source != DamageSource.Pet && !(info.instigator is Pet)) killUntil = Time.time + 0.3f;
        }

        void OnPlayerDamaged(float amount, Vector3 from)
        {
            hurtFrom = from;
            hurtArrowUntil = Time.time + 0.9f;
        }

        /// <summary>世界空间浮字（元素反应名「焚雷」…）：比伤害数字停留久一点、往上飘</summary>
        public void FloatText(Vector3 world, string text, Color c, float scale = 1.3f)
        {
            var n = SpawnNumber(world, text, c, scale);
            n.drift = new Vector3(0, 1.1f, 0);
            n.max = n.life = 1.15f;
        }

        Number SpawnNumber(Vector3 world, string text, Color c, float scale)
        {
            Number n = null;
            foreach (var x in numbers)
                if (x.life <= 0) { n = x; break; }
            if (n == null)
            {
                if (numbers.Count >= 80) n = numbers[0];
                else
                {
                    var t = Label("Damage", root, new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), 34, TextAnchor.MiddleCenter, Color.white);
                    t.gameObject.AddComponent<Outline>().effectColor = new Color(0, 0, 0, 0.75f);
                    n = new Number { text = t };
                    numbers.Add(n);
                }
            }
            n.text.text = text;
            n.text.color = c;
            n.text.fontSize = Mathf.RoundToInt(34 * scale);
            n.world = world;
            n.drift = new Vector3(Random.Range(-0.6f, 0.6f), 1.6f, 0);
            n.max = n.life = 0.85f;
            n.scale = scale;
            n.target = null;
            n.kind = 0;
            n.text.enabled = true;
            return n;
        }

        // ───────────── 每帧 ─────────────
        void LateUpdate()
        {
            if (!cam) return;
            float now = Time.time, dt = Time.deltaTime;
            var canvasRect = root.rect;

            if (vitals)
            {
                float hp = vitals.MaxHealth > 0 ? vitals.health / vitals.MaxHealth : 0;
                float sh = vitals.MaxShield > 0 ? vitals.shield / vitals.MaxShield : 0;
                SetFill(hpFill, hp);
                trail = Mathf.MoveTowards(Mathf.Max(trail, hp), hp, dt * 0.6f);
                SetFill(hpTrail, trail);
                SetFill(shieldFill, sh);
                hpText.text = $"{Mathf.CeilToInt(vitals.health)} <size=22><color=#9fd4ff>+{Mathf.CeilToInt(vitals.shield)}</color></size>";
                hpText.supportRichText = true;
                float low = Mathf.Clamp01(1 - hp / 0.3f);
                vignette.color = new Color(0.7f, 0.05f, 0.02f, low * 0.55f);
                float flash = Mathf.Clamp01(1 - (now - vitals.LastHitTime) / 0.35f);
                hurtFlash.color = new Color(1f, 0.1f, 0.05f, flash * 0.4f);
                deathText.color = new Color(1f, 0.35f, 0.25f, string.IsNullOrEmpty(deathText.text) ? 0 : 1);
            }
            if (motor)
            {
                for (int i = 0; i < dashPips.Count; i++)
                {
                    bool on = i < motor.dashCharges;
                    dashPips[i].enabled = on;
                    float fill = Mathf.Clamp01(motor.DashChargeLevel - i);
                    dashPips[i].color = fill >= 1 ? new Color(1f, 0.9f, 0.6f, 0.95f) : new Color(1f, 1f, 1f, 0.25f + fill * 0.3f);
                }
            }

            if (weapons && weapons.Active != null)
            {
                var w = weapons.Active;
                weaponName.text = w.Title;
                weaponName.color = WeaponLibrary.RarityColor[Mathf.Clamp(w.rarity, 0, 4)];
                ammoText.text = w.mag.ToString();
                ammoText.color = w.mag == 0 ? new Color(1f, 0.35f, 0.25f) : w.mag <= w.def.mag / 4 ? new Color(1f, 0.8f, 0.4f) : Color.white;
                reserveText.text = "/ " + w.reserve;
                reloadFill.transform.localScale = new Vector3(weapons.Reloading ? weapons.ReloadProgress : 0, 1, 1);

                // 准星：散布半角 → 屏幕像素（按当前 FOV 投影）
                float px = Mathf.Tan(weapons.HudSpread) / Mathf.Tan(cam.fieldOfView * 0.5f * Mathf.Deg2Rad) * canvasRect.height * 0.5f;
                float gap = 6 + px;
                cross[0].anchoredPosition = new Vector2(0, gap + 7);
                cross[2].anchoredPosition = new Vector2(0, -gap - 7);
                cross[1].anchoredPosition = new Vector2(gap + 7, 0);
                cross[3].anchoredPosition = new Vector2(-gap - 7, 0);
                float ca = 0.9f * (1 - weapons.AimT * 0.5f);
                foreach (var img in crossImg) img.color = new Color(1, 1, 1, ca);
            }

            bool kill = now < killUntil;
            float hitA = kill ? 1 : Mathf.Clamp01((hitUntil - now) / 0.12f);
            foreach (var img in hitImg) img.color = kill ? new Color(1f, 0.25f, 0.2f, hitA) : new Color(hitColor.r, hitColor.g, hitColor.b, hitA);
            hitMarker.localScale = Vector3.one * (kill ? 1.35f : 1f);

            float ba = Mathf.Clamp01((bannerUntil - now) / 0.5f);
            bannerText.color = new Color(1f, 0.9f, 0.65f, ba);
            toastText.color = new Color(toastColor.r, toastColor.g, toastColor.b, Mathf.Clamp01((toastUntil - now) / 0.4f));
            float fk = Mathf.Clamp01((flashUntil - Time.unscaledTime) / flashTime);
            screenFlash.enabled = fk > 0;
            if (fk > 0) screenFlash.color = new Color(flashColor.r, flashColor.g, flashColor.b, flashColor.a * fk * fk);
            coinText.text = $"灵石 {coins}";

            // 受击方向：屏幕中心外圈的红条指向来源（水平方位）
            float ha = Mathf.Clamp01((hurtArrowUntil - now) / 0.6f);
            hurtArrowImg.color = new Color(1f, 0.2f, 0.1f, ha * 0.85f);
            if (ha > 0 && vitals)
            {
                var to = hurtFrom - vitals.transform.position;
                var fwd = cam.transform.forward;
                float ang = Vector2.SignedAngle(new Vector2(fwd.x, fwd.z), new Vector2(to.x, to.z));
                hurtArrow.localRotation = Quaternion.Euler(0, 0, ang);
            }

            foreach (var n in numbers)
            {
                if (n.life <= 0) continue;
                n.life -= dt;
                if (n.life <= 0)
                {
                    n.text.enabled = false;
                    continue;
                }
                float t = 1 - n.life / n.max;
                var sp = cam.WorldToViewportPoint(n.world);
                if (sp.z <= 0)
                {
                    n.text.enabled = false;
                    continue;
                }
                n.text.enabled = true;
                var pos = new Vector2((sp.x - 0.5f) * canvasRect.width, (sp.y - 0.5f) * canvasRect.height);
                pos += new Vector2(n.drift.x * 40 * t, n.drift.y * 60 * t);
                n.text.rectTransform.anchoredPosition = pos;
                float pop = t < 0.12f ? Mathf.Lerp(1.5f, 1f, t / 0.12f) : 1f;
                n.text.rectTransform.localScale = Vector3.one * pop;
                var c = n.text.color;
                n.text.color = new Color(c.r, c.g, c.b, Mathf.Clamp01(n.life / 0.25f));
            }
        }

        static void SetFill(Image img, float f) => img.rectTransform.localScale = new Vector3(Mathf.Clamp01(f), 1, 1);
    }
}
