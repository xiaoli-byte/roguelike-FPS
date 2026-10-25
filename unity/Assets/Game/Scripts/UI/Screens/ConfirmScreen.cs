using System;
using UnityEngine;
using UnityEngine.UIElements;

namespace Spiritfire.Game
{
    /// <summary>确认框的内容（<see cref="ConfirmScreen.Ask"/>）</summary>
    public sealed class ConfirmRequest
    {
        public string title = "确认", message, detail;
        public string confirmText = "确定", cancelText = "取消";
        /// <summary>确认是不可撤销的操作（确认按钮朱砂色、默认聚焦在「取消」上）</summary>
        public bool danger = true;
        public Action onConfirm, onCancel;
    }

    /// <summary>
    /// 通用确认框（I5：有未完成的征程时「出征」要先确认放弃它）：标题、正文、补充说明、确认 / 取消两个按钮。
    /// 返回键 = 取消；危险操作默认聚焦在「取消」上，手柄连按确认键不会误点。不挡游戏、不停时间（主菜单场景要动），叠在当前界面上。
    /// 按钮和测试都走 <see cref="Confirm"/> / <see cref="Cancel"/>：先关自己再回调（回调里可以再开别的界面）。
    /// </summary>
    [UIScreen(ScreenId)]
    public sealed class ConfirmScreen : UIScreen
    {
        public const string ScreenId = "confirm";
        const string Style = "UI/dialog";

        public override string Id => ScreenId;
        public override GameState? BlockState => null;
        public override bool FreezeTime => false;

        ConfirmRequest req;
        VisualElement frame;
        Label title, message, detail;
        Button okBtn, cancelBtn;
        float openedAt;

        /// <summary>当前的请求（测试用）</summary>
        public ConfirmRequest Request => req;
        public string Message => req?.message;

        public override VisualElement DefaultFocus => req != null && req.danger ? cancelBtn : okBtn;

        /// <summary>弹一个确认框（已经开着就换内容）；界面没登记时直接当作确认（不会卡死），返回 false</summary>
        public static bool Ask(ConfirmRequest request)
        {
            if (request == null) return false;
            if (UIRouter.Get(ScreenId) == null)
            {
                Debug.LogWarning($"[UI] 没有确认框界面，直接确认：{request.message}");
                request.onConfirm?.Invoke();
                return false;
            }
            if (UIRouter.IsOpen(ScreenId)) UIRouter.Close(ScreenId);
            return UIRouter.Open(ScreenId, request);
        }

        protected override VisualElement Build()
        {
            var root = new VisualElement { name = "confirm" };
            ScreenKit.Style(root, ScreenKit.ScreensStyle);
            ScreenKit.Style(root, Style);
            root.AddToClassList("sf-dialog-screen");
            ScreenKit.El("sf-backdrop sf-dialog__backdrop", root);
            frame = ScreenKit.El("sf-frame sf-dialog", root);
            title = ScreenKit.Text("sf-dialog__title", frame, "", UIFontRole.Title);
            message = ScreenKit.Text("sf-dialog__message", frame, "");
            detail = ScreenKit.Text("sf-dialog__detail", frame, "");
            var foot = ScreenKit.El("sf-dialog__foot", frame);
            cancelBtn = ScreenKit.Btn("取消", "sf-btn--ghost sf-btn--wide", foot, Cancel);
            cancelBtn.name = "confirm-cancel";
            okBtn = ScreenKit.Btn("确定", "sf-btn--primary sf-btn--wide sf-sound-confirm", foot, Confirm);
            okBtn.name = "confirm-ok";
            return root;
        }

        public override void OnOpen(object arg)
        {
            req = arg as ConfirmRequest ?? new ConfirmRequest { message = "确定吗？" };
            openedAt = Time.unscaledTime;
            title.text = req.title ?? "";
            message.text = req.message ?? "";
            detail.text = req.detail ?? "";
            ScreenKit.Show(detail, !string.IsNullOrEmpty(req.detail));
            okBtn.text = req.confirmText ?? "确定";
            cancelBtn.text = req.cancelText ?? "取消";
            okBtn.EnableInClassList("sf-btn--danger-solid", req.danger);
            UIFonts.Warmup(req.title + req.confirmText + req.cancelText, UIFontRole.Title);
        }

        /// <summary>返回键 = 取消</summary>
        public override bool OnBack()
        {
            Cancel();
            return true;
        }

        /// <summary>确认：关掉自己，再回调 onConfirm</summary>
        public void Confirm() => Finish(true);

        /// <summary>取消：关掉自己，再回调 onCancel</summary>
        public void Cancel() => Finish(false);

        void Finish(bool ok)
        {
            var r = req;
            req = null;
            if (IsOpen) Close();
            if (r == null) return;
            try
            {
                if (ok) r.onConfirm?.Invoke();
                else r.onCancel?.Invoke();
            }
            catch (Exception e)
            {
                Debug.LogException(e);
            }
        }

        public override void Tick(float dt)
        {
            float k = ScreenKit.EaseOut((Time.unscaledTime - openedAt) / 0.22f);
            frame.style.opacity = k;
            float s = Mathf.Lerp(0.96f, 1f, k);
            frame.style.scale = new Scale(new Vector3(s, s, 1));
        }
    }
}
