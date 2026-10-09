const {test}=require('node:test');const assert=require('node:assert/strict');const {parseJSON,validatePlan,validateLesson,validateRobot}=require('../contracts.cjs');
test('Malformed plans, invalid asset settings and non-40-minute lessons cannot proceed',()=>{
 assert.throws(()=>parseJSON('not json'));assert.throws(()=>validatePlan({steps:[]}));assert.throws(()=>validatePlan({steps:[{task:'test',acceptance:[]}]}));assert.throws(()=>validateRobot({scale:0}));assert.throws(()=>validateRobot({color:[1,NaN,0]}));
 const lesson={title:'课题',objectives:['找出证据'],stages:[{title:'研读',minutes:40,activity:'小组研读',question:'证据在哪？'}],sourceQuotes:[],reviewNotes:['教师复核']};assert.equal(validateLesson(lesson).stages[0].minutes,40);assert.throws(()=>validateLesson({...lesson,stages:[{...lesson.stages[0],minutes:39}]}));
 assert.equal(validateRobot({}).scale,1);
});
