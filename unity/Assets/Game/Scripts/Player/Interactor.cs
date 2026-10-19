using System;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.InputSystem;

namespace Spiritfire.Game
{
    /// <summary>玩家交互：每帧挑一个可交互物，在 HUD 上提示「[F] …」，按 F 触发。测试用 testInteract 代替按键</summary>
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
            var kb = Keyboard.current;
            if (TestMode ? testInteract : kb != null && kb.fKey.wasPressedThisFrame)
            {
                testInteract = false;
                Current.Interact();
            }
        }
    }
}
