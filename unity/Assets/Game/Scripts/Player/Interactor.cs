using System;
using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>玩家交互：每帧挑一个可交互物，在 HUD 上显示它的提示卡（[F] …），按交互键（F / 手柄 Y）触发。测试用 testInteract 代替按键</summary>
    public sealed class Interactor : MonoBehaviour
    {
        public static bool TestMode;
        public bool testInteract;

        WeaponController weapons;
        PlayerMotor motor;
        PlayerVitals vitals;
        InteractPrompt? shown;
        public IInteractable Current { get; private set; }

        void Awake()
        {
            weapons = GetComponent<WeaponController>();
            motor = GetComponent<PlayerMotor>();
            vitals = GetComponent<PlayerVitals>();
        }

        void Update()
        {
            var eye = weapons && weapons.eye ? weapons.eye.transform : transform;
            bool canAct = (TestMode || (motor && motor.inputEnabled)) && (!vitals || !vitals.Dead) && Time.timeScale > 0;
            Current = canAct ? Interaction.Pick(eye) : null;
            InteractPrompt? card = Current != null ? Current.PromptCard : null;
            if (!Nullable.Equals(card, shown))
            {
                shown = card;
                GameUI.SetPrompt(card);
            }
            if (Current == null) return;
            if (TestMode ? testInteract : GameInput.Pressed(GameAction.Interact))
            {
                testInteract = false;
                Current.Interact();
            }
        }
    }
}
