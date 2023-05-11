const t = require('@babel/types');
const traverse = require('@babel/traverse').default;
const vm = require('vm')


function replaceConstantIntsFromCtx(AST, ctx) {
    traverse(AST, {
        VariableDeclarator(path) {
            const {node, scope} = path
            if (!ctx[node.id.name] && ctx[node.id.name] !== 0) return
            if (typeof ctx[node.id.name] !== 'number') return
            const binding = scope.getBinding(node.id.name)
            binding.referencePaths.forEach(reference => {
                reference.replaceWith(t.numericLiteral(ctx[node.id.name]))
            })
            binding.constantViolations.forEach(assignment => {
                assignment.remove()
            })
            path.remove()
        }
    })
}

function replaceMemberExpressionsFromCtx(AST, ctx, decoder_arr_id) {
    traverse(AST, {
        MemberExpression(path) {
            const {node} = path
            if (!(node.object.name && node.object.name !== decoder_arr_id && ctx[node.object.name] && Array.isArray(ctx[node.object.name]))) return
            if (!t.isNumericLiteral(node.property)) return
            const value = vm.runInContext(path.toString(), ctx)
            if (!value && value !== 0) return
            if (isNaN(value)) {
                path.replaceWith(t.stringLiteral(value))
            } else {
                path.replaceWith(t.numericLiteral(value))
            }
        }
    })
}

module.exports = { replaceConstantIntsFromCtx, replaceMemberExpressionsFromCtx }