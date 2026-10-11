/** Two form-specific abilities; real weapon damage and real fragment ownership. */
import * as THREE from 'three';
import type { DamageRequest, GameContext, IEnemy, WeaponForm, WeaponInstance, WeaponSkillState } from '../core/types';
import { bladeColor, sweepSector } from './Melee';
import { weaponSkillFor, type WeaponSkillParams } from './WeaponDefs';
import type { ResolvedWeapon } from './WeaponStats';

export const WEAPON_SKILL_KEY='V';
export interface BladeSkillHost {
  resolve(inst:WeaponInstance):ResolvedWeapon;
  interrupt():void;
  surge(inst:WeaponInstance,point:THREE.Vector3,params:WeaponSkillParams):number;
  fireCell(inst:WeaponInstance,point:THREE.Vector3,mult:number):boolean;
  recall(inst:WeaponInstance):void;
  cancelSurge(uid:number):void;
}
type Cooldown={left:number;total:number;base:number};
const _aim=new THREE.Vector3(),_center=new THREE.Vector3();
const TAGS=['slash','weaponSkill'];

export class BladeSkill {
  private inst:WeaponInstance|null=null;
  private params:WeaponSkillParams|null=null;
  private form:WeaponForm='melee';
  private elapsed=0;
  private struck=false;
  private echoed=false;
  private emitted=0;
  private volley=0;
  private readonly point=new THREE.Vector3();
  private readonly targets:IEnemy[]=[];
  private readonly found:IEnemy[]=[];
  private readonly cooldowns:Record<WeaponForm,Cooldown>={melee:{left:0,total:12,base:12},ranged:{left:0,total:18,base:18}};
  private lastDeny=-99;
  private readonly hud:WeaponSkillState={id:'',name:'',glyph:'',key:'V',cooldownRemaining:0,cooldownTotal:12,active:false};
  constructor(private readonly ctx:GameContext,private readonly host:BladeSkillHost) {}
  /** Casting lock, retained name for the weapon input gate. Neither ability forces movement. */
  get dashing():boolean {return this.inst!==null;}
  get dashProgress():number {return this.params ? Math.min(1,this.elapsed/this.params.castTime) : -1;}
  fill(def:WeaponSkillParams,form:WeaponForm='melee'):WeaponSkillState {
    const cd=this.cooldowns[form];
    return Object.assign(this.hud,{id:def.id,name:def.name,description:def.description,glyph:def.glyph,key:'V',
      cooldownRemaining:cd.left,cooldownTotal:cd.left>0?cd.total:this.totalFor(def.cooldown),active:!!this.inst&&this.form===form});
  }
  tryCast(inst:WeaponInstance,R:ResolvedWeapon,form:WeaponForm='melee'):boolean {
    const sk=weaponSkillFor(R.def,form),ctx=this.ctx,cd=this.cooldowns[form];
    if(!sk || this.inst || !ctx.player.alive) return false;
    if(cd.left>0) {this.deny();return false;}
    ctx.player.getAimDirection(_aim);
    const wall=ctx.world.raycast(ctx.player.eye,_aim,sk.range);
    const distance=wall?.distance??sk.range;
    const enemy=ctx.enemies.raycast(ctx.player.eye,_aim,distance);
    this.point.copy(enemy?.point??wall?.point??ctx.player.eye.clone().addScaledVector(_aim,distance));
    this.host.interrupt();
    let count=0;
    if(sk.kind==='surge') {
      count=this.host.surge(inst,this.point,sk);
      if(count===0 && inst.mag<=0) {this.deny();return false;}
    }
    this.inst=inst;this.params=sk;this.form=form;this.elapsed=0;this.struck=this.echoed=false;
    this.emitted=0;this.volley=count>0?0:Math.min(inst.mag,sk.volleyCount??32);this.targets.length=0;
    cd.base=sk.cooldown;cd.total=this.totalFor(sk.cooldown);cd.left=cd.total;
    ctx.audio.play('blade_dash',{volume:.75,pitch:sk.kind==='cleave' ? .72 : 1.4});
    ctx.events.emit('weapon:skillUsed',{weapon:inst,skillId:sk.id});
    return true;
  }
  update(dt:number):void {
    if(dt<=0) return;
    for(const cd of Object.values(this.cooldowns)) {
      const total=this.totalFor(cd.base);
      if(cd.total!==total && cd.total>0) cd.left*=total/cd.total;
      cd.total=total;cd.left=Math.max(0,cd.left-dt);
    }
    if(!this.inst || !this.params) return;
    if(!this.ctx.player.alive) {this.abort();return;}
    this.elapsed+=dt;
    const sk=this.params,inst=this.inst;
    if(sk.kind==='cleave') {
      if(!this.struck && this.elapsed>=sk.chargeTime) {this.struck=true;this.cleave(false);}
      if(this.inst && !this.echoed && this.elapsed>=sk.chargeTime+(sk.echoDelay??.2)) {this.echoed=true;this.cleave(true);}
    } else {
      while(this.emitted<this.volley && this.elapsed>=sk.chargeTime+this.emitted*(sk.volleyInterval??.009)) {
        if(!this.host.fireCell(inst,this.point,sk.projectileMult??2)) {this.emitted=this.volley;break;}
        this.emitted++;
      }
    }
    if(this.inst && this.elapsed>=sk.castTime) {
      this.inst=null;this.params=null;this.targets.length=0;
      if(sk.kind==='surge') this.host.recall(inst);
    }
  }
  abort():void {
    if(this.inst && this.params?.kind==='surge') this.host.cancelSurge(this.inst.uid);
    this.inst=null;this.params=null;this.targets.length=this.found.length=0;this.elapsed=0;
  }
  resetForRun():void {this.abort();for(const cd of Object.values(this.cooldowns)){cd.left=0;cd.total=this.totalFor(cd.base);}this.lastDeny=-99;}
  private totalFor(base:number):number {return Math.max(.1,base/Math.max(.2,1+this.ctx.player.stats.get('skillHaste')));}
  private deny():void {if(this.ctx.time.now-this.lastDeny>=.4){this.lastDeny=this.ctx.time.now;this.ctx.audio.play('ui_deny',{volume:.5});}}
  private cleave(echo:boolean):void {
    const inst=this.inst,sk=this.params;if(!inst || !sk) return;
    const ctx=this.ctx,R=this.host.resolve(inst),color=bladeColor(inst,R.def),player=ctx.player;
    const eligible=sweepSector(ctx,{range:sk.range,halfAngle:sk.halfAngle},R.def.melee!,this.found);
    if(!echo) this.targets.push(...eligible.slice(0,sk.maxTargets??24));
    ctx.fx.blade.slashArc(player.eye,player.yaw,0,echo?1:0,sk.range,sk.halfAngle,color);
    ctx.fx.shake(echo ? .15 : .38,echo ? .10 : .16);
    for(const enemy of [...this.targets]) {
      if(!enemy.alive || !eligible.includes(enemy)) continue;
      enemy.getBodyCenter(_center);
      const direction=_center.clone().sub(player.eye).normalize();
      const req:DamageRequest={base:(echo?sk.echoDamage??0:sk.damage)*R.damageMult,element:inst.element,source:'weapon',
        elementChance:R.meleeElementChance,critMult:R.critMult,weaponUid:inst.uid,point:_center.clone(),direction,
        knockback:echo?2:4,procDepth:0,tags:TAGS};
      if(R.critChance>0 && ctx.rng.next()<R.critChance) req.forceCrit=true;
      ctx.combat.damageEnemy(enemy,req);ctx.fx.blade.slashHit(req.point!,direction,color,!echo);
    }
    ctx.audio.play(echo?'blade_impale':'blade_hit',{volume:echo ? .6 : 1,pitch:echo?1.4:.7});
  }
}
