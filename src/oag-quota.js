const finite=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;

export function daysRemaining(date){
  const [year,month,day]=String(date||"").split("-").map(Number);
  if(!year||!month||!day)return 1;
  return Math.max(1,new Date(Date.UTC(year,month,0)).getUTCDate()-day+1);
}

export function releaseRatio(minutes){
  const value=Math.max(0,finite(minutes));
  if(value>=21*60)return 1;
  if(value>=18*60)return 0.90;
  if(value>=15*60)return 0.75;
  if(value>=12*60)return 0.55;
  if(value>=9*60)return 0.35;
  if(value>=6*60)return 0.20;
  return 0.08;
}

export function quotaPlan({date,minutes,dayCalls=0,monthCalls=0,limit=1000}={}){
  const safeLimit=Math.max(1,Math.floor(finite(limit,1000)));
  const day=Math.max(0,Math.floor(finite(dayCalls)));
  const month=Math.max(day,Math.floor(finite(monthCalls)));
  const daysLeft=daysRemaining(date);
  const reserveRate=daysLeft<=3?0.01:daysLeft<=7?0.03:0.05;
  const reserveFloor=daysLeft<=3?10:daysLeft<=7?20:30;
  const reserve=Math.min(safeLimit,Math.max(reserveFloor,Math.ceil(safeLimit*reserveRate)));
  const monthCap=Math.max(0,safeLimit-reserve);

  // Retirer les appels d'aujourd'hui stabilise l'objectif pendant toute la journée.
  const usedBeforeToday=Math.max(0,month-day);
  const availableAtDayStart=Math.max(0,monthCap-usedBeforeToday);
  const dailyTarget=availableAtDayStart
    ? Math.min(200,Math.max(1,Math.ceil(availableAtDayStart/daysLeft)))
    : 0;
  const criticalReserve=dailyTarget
    ? Math.min(12,Math.max(2,Math.ceil(dailyTarget*0.15)))
    : 0;
  const hardDayMax=Math.min(availableAtDayStart,dailyTarget+criticalReserve);
  const normalCap=Math.min(hardDayMax,Math.ceil(dailyTarget*releaseRatio(minutes)));

  return {
    limit:safeLimit,
    daysLeft,
    reserve,
    monthCap,
    monthRemaining:Math.max(0,safeLimit-month),
    safeMonthRemaining:Math.max(0,monthCap-month),
    usedBeforeToday,
    availableAtDayStart,
    dailyTarget,
    criticalReserve,
    normalCap,
    hardDayMax
  };
}
