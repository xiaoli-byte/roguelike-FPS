using System;
using UnityEngine;

namespace Spiritfire.Game
{
    [Serializable]
    public sealed class GunfireMotionData
    {
        public bool m_isMainWeapon;
        public bool FixedPoint;
        public Vector3 FixedPosition;
        public float PositionSpringStiffness;
        public float PositionSpringDamping;
        public float PositionSpring2Stiffness;
        public float PositionSpring2Damping;
        public float PositionSpring3Stiffness;
        public float PositionSpring3Damping;
        public float PositionKneeling;
        public int PositionKneelingSoftness;
        public float PositionFallRetract;
        public Vector3 PositionWalkSlide;
        public float PositionInputVelocityScale;
        public float PositionMaxInputVelocity;
        public float RotationSpringStiffness;
        public float RotationSpringDamping;
        public float RotationSpring2Stiffness;
        public float RotationSpring2Damping;
        public float RotationSpring3Stiffness;
        public float RotationSpring3Damping;
        public float RotationKneeling;
        public int RotationKneelingSoftness;
        public Vector3 RotationLookSway;
        public Vector3 RotationStrafeSway;
        public Vector3 RotationFallSway;
        public Vector3 PositionFallSway;
        public float RotationSlopeSway;
        public float RotationInputVelocityScale;
        public float RotationMaxInputVelocity;
        public float ShakeSpeed;
        public Vector3 ShakeAmplitude;
        public Vector3 ShakePosition;
        public Vector3 BobRotation;
        public Vector3 BobRotationAmplitude;
        public Vector3 BobPosition;
        public Vector3 BobPositionAmplitude;
        public float BobInputVelocityScale;
        public float BobMaxInputVelocity;
        public bool BobRequireGroundContact;
        public Vector3 StepPositionForce;
        public Vector3 StepRotationForce;
        public int StepSoftness;
        public float StepMinVelocity;
        public float StepPositionBalance;
        public float StepRotationBalance;
        public float StepForceScale;
        public float MotionPositionReset;
        public float MotionRotationReset;
        public Vector3 MotionPositionRecoil;
        public Vector3 MotionRotationRecoil;
        public Vector3 MotionPositionMaxState;
        public float MotionRotationRecoilDeadZone;
        public float MotionRecoilInterval;
        public float FireFOVOffset;
        public float FireFOVMax;
        public float FireFOVTime;
        public float FireFOVRecoverTime;
        public float HitPositionReset;
        public float HitRotationReset;
        public Vector3 HitPositionRecoil;
        public Vector3 HitRotationRecoil;
        public float HitRotationRecoilDeadZone;
        public Vector3 HitPositionMaxState;
        public float SwitchWeaponRoatation;
        public float SwitchWeaponPosition;
        public float PutDownTime;
        public float PullOutTime;
        public float CamRotationSpringStiffness;
        public float CamRotationSpringDamping;
        public Vector3 CameraRollOffset;
        public float ReloadWeaponRoatation;
        public float ReloadPutDownTime;
        public float ReloadPullOutTime;
        public float SightRatio;
        public float SightFOVChangeTime;
        public float FocusFOV;
        public float FocussingEndTime;
        public float FocussingStartTime;
        public float IronSightFOVOffset;
        public float IronSightOpenTime;
        public float IronSightCloseTime;
        public float FOVOffset;
        public float FOVSetTime;
        public float FOVRecoverTime;
    }

    [Serializable]
    public sealed class GunfireCameraData
    {
        public bool UseCustomRecoil;
        public float X_Change_Prob;
        public float RecoilMax_X;
        public float RecoilMax_Y;
        public float RecoilTime;
        public float RandomMin_X;
        public float RandomMin_Y;
        public float RandomMax_X;
        public float RandomMax_Y;
        public float RecoverSpeed;
        public float StabilityOffset;
        public float Axis_X_Y_Ratio;
        public float RecoilUpLimit;
        public float RecoilDownLimit;
        public float SightMax;
        public float SightMin;
        public float SightDefaultUse;
        public float SightSpeed;
        public float SightSmoothTime;
        public float CrazyShootRecoilMax_Y;
        public int IronSightOption;
        public Vector2[] CustomRecoils;
    }

    [Serializable]
    public sealed class GunfireNormalData
    {
        public Vector3 PositionOffset;
        public Vector3 PositionOffset_Refer;
        public Vector3 PositionSightOffset;
        public Vector3 PositionDWOffset;
        public Vector3 PositionFocusOffset;
        public Vector3 PositionIronSightOffset;
        public Vector3 RotationOffset;
        public Vector3 RotationOffset_Refer;
        public Vector3 RotationSightOffset;
        public Vector3 RotationDWOffset;
        public Vector3 RotationFocusOffset;
        public Vector3 RotationIronSightOffset;
        public float DWOffsetMinDis;
    }

    [Serializable]
    public sealed class GunfireWeaponMotionDocument
    {
        public GunfireMotionData motion;
        public GunfireCameraData camera;
        public GunfireNormalData normal;
    }
}
