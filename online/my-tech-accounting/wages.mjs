const wageUnits={day:'วัน',hour:'ชั่วโมง'};
function wageDecimal(value,places){const text=String(value??'').trim();if(!new RegExp('^\\d+(?:\\.\\d{1,'+places+'})?$').test(text))throw Error('จำนวนและอัตราค่าแรงต้องเป็นเลขบวก ทศนิยมไม่เกิน '+places+' ตำแหน่ง');const [whole,fraction='']=text.split('.'),number=Number(whole)*10**places+Number(fraction.padEnd(places,'0'));if(!Number.isSafeInteger(number)||number<=0||number>1e12)throw Error('จำนวนหรืออัตราค่าแรงเกินขอบเขต');return number;}
const wageProduct=(quantity,rate)=>Number((BigInt(quantity)*BigInt(rate)+500n)/1000n);
export function wageCalculation(input){
  if(!input||input.enabled===false)return null;
  if(!Object.hasOwn(wageUnits,input.unit))throw Error('เลือกค่าแรงรายวันหรือรายชั่วโมง');
  const quantity=wageDecimal(input.quantity,3),rate=wageDecimal(input.rate,2),amount=wageProduct(quantity,rate);
  if(!Number.isSafeInteger(amount)||amount<=0||amount>1e12)throw Error('ยอดค่าแรงต้องมากกว่า 0 และไม่เกินขอบเขต');
  return {unit:input.unit,quantity,rate,amount};
}
export function validateWage(value){if(!value)return;for(const key of ['quantity','rate','amount'])if(!Number.isSafeInteger(value[key])||value[key]<=0||value[key]>1e12)throw Error('ข้อมูลค่าแรงไม่ถูกต้อง');if(!Object.hasOwn(wageUnits,value.unit)||wageProduct(value.quantity,value.rate)!==value.amount)throw Error('ยอดค่าแรงไม่ตรงกับจำนวนและอัตรา');}
export function wageLabel(value){return 'ค่าแรง '+(value.quantity/1000)+' '+wageUnits[value.unit]+' × '+(value.rate/100).toFixed(2)+' บาท';}
