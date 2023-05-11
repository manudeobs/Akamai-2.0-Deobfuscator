const t = require('@babel/types');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const vm = require('vm')


function evalIntegrityValue(AST, ctx, script_b64) {
    let decoder_object, window_proxy
    traverse(AST, {
        AssignmentExpression(path) {
            const {node} = path
            if (node.right.name === 'window') {
                vm.runInContext(`var ${node.left.name} = this`, ctx)
                vm.runInContext(`var ${generate(path.parentPath.parentPath.parentPath.parentPath.node.body[0]).code}`, ctx)
                window_proxy = node.left.name
                decoder_object = path.parentPath.parentPath.parentPath.parentPath.node.body[0].expression.left.name
            }
            if (!t.isCallExpression(node.right)) return
            if (node.right.arguments.length !== 3) return
            if (!t.isCallExpression(node.right.arguments[0])) return
            if (!t.isStringLiteral(node.right.arguments[1])) return
            if (!t.isStringLiteral(node.right.arguments[2])) return
            if (decoder_object) path.stop()
            const checksum = vm.runInContext(`${path.toString().replace(generate(node.right.arguments[0]).code, `Buffer.from("${script_b64}", "base64").toString()`)}`, ctx)
            path.parentPath.parentPath.parentPath.parentPath.scope.getBinding(node.left.name).referencePaths.forEach(reference => {
                reference.replaceWith(t.numericLiteral(checksum))
            })
            path.parentPath.parentPath.parentPath.remove()
        }
    })
    return {decoder_object, window_proxy}
}

function patchSensorDataNull(AST, decoder_object) {
    traverse(AST, {
        AssignmentExpression(path) {
            const {node} = path
            if (node.left.object?.name !== decoder_object) return
            if (node.right.property?.name !== 'toString') return
            const memberexp = node.left
            path.stop()
            path.findParent((path) => path.isProgram()).traverse({
                MemberExpression(path) {
                    const {node} = path
                    if (!t.isNodesEquivalent(node, memberexp)) return
                    if (path.parentPath.type !== 'MemberExpression') return
                    if (path.parentPath.parentPath.type !== 'CallExpression') return
                    const block = path.findParent((path) => path.isVariableDeclaration()).getAllNextSiblings()
                    const target = block[block.length - 1]
                    if (target.type !== 'IfStatement') return
                    target.remove()
                }
            })
        }
    })
}

module.exports = { evalIntegrityValue, patchSensorDataNull }