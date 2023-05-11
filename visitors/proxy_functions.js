const t = require('@babel/types');
const traverse = require('@babel/traverse').default;

const unnestProxyFunctions = {
    BlockStatement(path) {
        const {node, scope} = path
        path.stop()
        node.body.forEach(node => {
            if (!(t.isFunctionDeclaration(node) || (t.isVariableDeclaration(node) && node.declarations && t.isFunctionExpression(node.declarations[0].init)))) return
            const body = node.body?.body || node.declarations[0].init.body.body
            if (!t.isReturnStatement(body[0])) return
            if (t.isArrayExpression(body[0].argument)) return
            if (t.isCallExpression(body[0].argument) && body[0].argument.callee?.property?.name === 'apply') return
            const references = scope.getBinding(node.id?.name || node.declarations[0].id.name).referencePaths
            switch(body[0].argument.type) {
                case 'BinaryExpression':
                    const operator = body[0].argument.operator
                    references.forEach(reference => {
                        while (true) {
                            try {
                                const reference_node = reference.parentPath.node
                                const replacement = t.binaryExpression(operator, reference_node.arguments[0], reference_node.arguments[1])
                                reference.parentPath.replaceWith(replacement)
                                break
                            } catch(e) {
                                reference.scope.crawl()
                            }
                        }
                        
                    })
                    break
                case 'CallExpression':
                    references.forEach(reference => {
                        const reference_node = reference.parentPath.node
                        const replacement = t.cloneNode(body[0].argument)
                        replacement.callee.object = reference_node.arguments[0]
                        replacement.arguments = [reference_node.arguments[1]]
                        reference.parentPath.replaceWith(replacement)
                    })
                    break
                case 'UnaryExpression':
                    references.forEach(reference => {
                        while (true) {
                            try {
                                const reference_node = reference.parentPath.node
                                const replacement = t.cloneNode(body[0].argument)
                                replacement.argument = reference_node.arguments[0]
                                reference.parentPath.replaceWith(replacement)
                                break
                            } catch(e) {
                                reference.scope.crawl()
                            }
                        }
                        
                    })
                    break
            }
        })
    }
}

module.exports = { unnestProxyFunctions }