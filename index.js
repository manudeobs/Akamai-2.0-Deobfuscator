const fs = require('fs');
const t = require('@babel/types');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const vm = require('vm');

const { 
    prepareControlFlowUnflattening, 
    unflattenSimpleSwitchLoops, 
    unflattenTrickySwitchLoop } = require('./visitors/control_flow.js')
const {
    replaceConstantIntsFromCtx,
    replaceMemberExpressionsFromCtx } = require('./visitors/fill_constants.js')
const { 
    findDecoderArrayId, 
    removeStringConcealing } = require('./visitors/string_concealing.js')
const { unnestProxyFunctions } = require('./visitors/proxy_functions.js');
const { evalIntegrityValue,
    patchSensorDataNull } = require('./visitors/integrity_checks.js');
const { 
    removeDeadCode, 
    evalUnaryExpressions,
    evalNonStringConcealingFunctions,
    bracketToDot,
    replaceConstants,
    removeWindowProxy,
    concatToUnaryExpression } = require('./visitors/utils.js');

const script = fs.readFileSync('script.js', 'utf-8')
var AST = parser.parse(script, {});
const ctx = vm.createContext({Buffer: Buffer});

const code = /\((.*)\(/.exec(fs.readFileSync('script.js').toString())[1]
const script_b64 = Buffer.from(code).toString('base64')

// Integrity check, can't be executed in ctx
AST.program.body[0].expression.callee.body.body.shift()

const patchWindowTypeof = {
    BinaryExpression(path) {
        const {node} = path
        if (node.operator !== '+') return
        if (!t.isUnaryExpression(node.right)) return
        if (node.right.operator !== 'typeof') return
        path.stop()
        node.right = t.stringLiteral('undefined')
    }
}

traverse(AST, patchWindowTypeof)

// As javascript allows executing functions located in the same scope but declared later (line-wise)
// we have to loop through the nodes until all have been successfully executed and been added to the ctx
const nodes = [...AST.program.body[0].expression.callee.body.body]
var entry

while (nodes.length !== 0) {
    const node = nodes.shift()
    if (node.type === 'ReturnStatement') {
        entry = node
        continue
    }
    try {
        vm.runInContext(generate(node).code, ctx)
    } catch(e) {
        nodes.push(node)
    }
}


const {decoder_object, window_proxy} = evalIntegrityValue(AST, ctx, script_b64)
for (const node of AST.program.body[0].expression.callee.body.body) {
    if (node.declarations && node.declarations[0].id.name === decoder_object) {
        node.declarations[0].init = t.objectExpression([])
    } else if (node.declarations && node.declarations[0].id.name === window_proxy) {
        node.declarations[0].init = t.identifier('window')
    }
}

// Execute script just like browser would until it eventually throws an exception, decoder functions etc. are set anyways
try{
    vm.runInContext(`(function(){${generate(entry).code}})()`, ctx)
} catch(e) {}

replaceConstantIntsFromCtx(AST, ctx)
const decoder_arr_id = findDecoderArrayId(AST)


replaceMemberExpressionsFromCtx(AST, ctx, decoder_arr_id)
AST = removeDeadCode(AST)

traverse(AST, unnestProxyFunctions)
AST = removeDeadCode(AST)

traverse(AST, evalUnaryExpressions)

const {funcs, entries} = prepareControlFlowUnflattening(AST)
unflattenSimpleSwitchLoops(AST, funcs, entries)
unflattenTrickySwitchLoop(AST, entries, ctx)

removeStringConcealing(AST, ctx, decoder_object, decoder_arr_id)
evalNonStringConcealingFunctions(AST, ctx, decoder_object)

removeWindowProxy(AST, window_proxy)
traverse(AST, bracketToDot)

AST = replaceConstants(AST)

patchSensorDataNull(AST, decoder_object)
AST = removeDeadCode(AST)

traverse(AST, concatToUnaryExpression)

const {body: main_body} = AST.program.body[0].expression.callee.body

for (let i = 0; i < main_body.length; i++) {
    if (main_body[i].type !== 'ReturnStatement') continue
    const return_call = main_body.splice(i, 1)[0]
    main_body.push(return_call)
}

fs.writeFileSync('out.js', generate(AST).code)

// Everything until here does the main work required to properly
// read and understand the script
// Removed to this point:
//
// - Integrity checks
//      => script toString() which breaks the whole script on modifcation
//      => toString() on a certain function causing {"sensor_data":"0"}
//
// - Replacing constants evaled in the vm context
//      => integers first
//      => MemberExpression that can be evaled using the replaced integers
//
// - Removal of proxy function which mostly perform unary operations
//
// - Evaluating of confident UnaryExpressions
//
// - Control Flow Unflattening
//      => the "simple" loops which use param as starter index
//      => the "advanced" loop which modifies the starter index based of some calls,
//         which is finally also removed so the programs flow can be better understood
//
// - String Concealing
//      => Handling scope awareness by traversing backwards from the deepest blocks back to the whole program