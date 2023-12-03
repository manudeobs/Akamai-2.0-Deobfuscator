const t = require('@babel/types');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const vm = require('vm');

function removeDeadCode(AST) {
    let removed
    do {
        removed = 0
        AST = parser.parse(generate(AST).code)
        traverse(AST, {
            "VariableDeclarator|FunctionDeclaration"(path) {
                const {node, scope} = path
                const {referenced, constantViolations} = scope.getBinding(node.id.name)
                if (!referenced && constantViolations.length === 0) { 
                    removed++
                    path.remove()
                }
            }
        })
    } while (removed !== 0)
    return AST
}

const evalUnaryExpressions = {
    UnaryExpression(path) {
        if (t.isUnaryExpression(path.parentPath.node)) return
        const {confident, value} = path.evaluate()
        if (confident && value != path.toString()) {
            if (typeof value === 'boolean') path.replaceWith(t.booleanLiteral(value))
            else if (typeof value === 'number') path.replaceWith(t.numericLiteral(value))
            else path.replaceWith(t.identifier('undefined')) 
        }
    }
}

function evalNonStringConcealingFunctions(AST, ctx, decoder_object) {
    traverse(AST, {
        CallExpression(path) {
            const {node} = path
            if (node.callee.object?.name !== decoder_object) return
            if (node.arguments.length === 0) {
                path.replaceWith(t.numericLiteral(vm.runInContext(path.toString(), ctx)))
            } else {
                path.replaceWith(t.valueToNode(vm.runInContext(path.toString(), ctx)))
            }
        }
    })
}

const bracketToDot = {
    MemberExpression(path) {
        const {node} = path
        if (!t.isStringLiteral(node.property)) return
        if (!/[A-Za-z_]/.test(node.property.value[0])) return
        path.replaceWith(t.memberExpression(node.object, t.identifier(node.property.value), false))
    }
}

function replaceConstants(AST) {
    var edits
    const replaceConstants = {
        VariableDeclarator(path) {
            const {node, scope} = path
            if (!t.isStringLiteral(node.init) && !t.isNumericLiteral(node.init) && !t.isBooleanLiteral(node.init)) return
            const bindings = scope.getBinding(node.id.name)
            if (bindings.constantViolations.length !== 0) return
            bindings.referencePaths.forEach(reference => {
                reference.replaceWith(node.init)
                edits++
            })
            path.remove()
        }
    }
    
    var edits
    do {
        edits = 0
        AST = parser.parse(generate(AST).code)
        traverse(AST, replaceConstants)
    } while (edits !== 0)
    return AST
}

function removeWindowProxy(AST, window_proxy) {
    traverse(AST, {
        MemberExpression(path) {
            const {node} = path
            if (node.object.name !== window_proxy) return
            path.replaceWith(t.identifier(node.property.value))
        }
    })
}

const concatToUnaryExpression = {
    CallExpression(path) {
        const {node} = path
        if (node.callee?.property?.name !== 'concat') return
        if (node.arguments.length === 2) {
            if (node.callee.object.value === '') {
                path.replaceWith(t.binaryExpression('+', node.arguments[0], node.arguments[1]))
            } else {
                const binary_exp = t.binaryExpression('+', node.callee.object, node.arguments[0])
                path.replaceWith(t.binaryExpression('+', binary_exp, node.arguments[1]))
            }
        } else if (node.arguments.length === 1) {
            path.replaceWith(t.binaryExpression('+', node.callee.object, node.arguments[0]))
        }
        
    }
}


module.exports = { removeDeadCode, evalUnaryExpressions, evalNonStringConcealingFunctions, bracketToDot, replaceConstants, removeWindowProxy, concatToUnaryExpression }