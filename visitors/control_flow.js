const t = require('@babel/types');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const vm = require('vm');

function prepareControlFlowUnflattening(AST) {

    const funcs = []
    const entries = {}

    const turnVariableDeclaratorsToFunctions = {
        VariableDeclaration(path) {
            const {node, scope} = path
            if (path.parentPath.parentPath.parentPath.parentPath.parentPath.type !== 'Program') return
            if (!t.isFunctionExpression(node.declarations[0].init)) return
            const body = node.declarations[0].init.body.body
            if (!t.isWhileStatement(body[body.length - 1]) && !t.isDoWhileStatement(body[body.length - 1]) && !t.isForStatement(body[body.length - 1])) return
            scope.getBinding(node.declarations[0].id.name).referencePaths.forEach(reference => {
                reference.replaceWith(node.declarations[0].init.id)
            })
            const func = node.declarations[0].init
            path.replaceWith(t.functionDeclaration(func.id, func.params, func.body))
            funcs.push(func.id.name)
            entries[func.id.name] = []
        }
    }
    
    traverse(AST, turnVariableDeclaratorsToFunctions)
    
    const findAllEntryIntegers = {
        CallExpression(path) {
            const {node, scope} = path
            if (t.isIdentifier(node.callee)) {
                if (!funcs.includes(node.callee.name)) return
                if (node.arguments[0].value) entries[node.callee.name].push(node.arguments[0].value)
            }
            else if (t.isMemberExpression(node.callee)) {
                if (!funcs.includes(node.callee.object.name)) return
                if (node.callee.property.name === 'apply') {
                    entries[node.callee.object.name].push(node.arguments[1].elements[0].value)
                }
                else {
                    entries[node.callee.object.name].push(node.arguments[1].value)
                }
            }
        }
    }
    traverse(AST, findAllEntryIntegers)
    
    Object.keys(entries).forEach(key => {
        entries[key] = [ ...new Set(entries[key])]  
    })

    return {funcs, entries}
}

function unflattenSimpleSwitchLoops(AST, funcs, entries) {
    const removeControlFlattening = {
        SwitchStatement(path) {
            const {node, scope} = path
            const func = path.findParent((path) => path.isFunctionDeclaration());
            if (!func) return
            if (!entries[func.node.id.name]) return

            // skips the tricky one for now
            for (const child of func.node.body.body) {
                if (child.expression?.callee?.property?.name === 'set') return
            }
            const id = func.node.id.name
            const condition = path.parentPath.parentPath.node.test
            const discriminant = node.discriminant.name
    
            // merges all cases which belong together
            entries[id].forEach(entry => {
              const innerCtx = vm.createContext({})
              vm.runInContext(`var ${discriminant} = ${entry}`, innerCtx)
              const body = []
              var exit = false
              while (!exit && eval(generate(condition).code.replace(discriminant, innerCtx[discriminant]))) {
                for (const _case of node.cases) {
                  if (_case.test.value !== innerCtx[discriminant]) continue
                  _case.consequent[0].body.forEach(node => {
                    if (t.isExpressionStatement(node) && t.isAssignmentExpression(node.expression) && node.expression.left.name === discriminant) {
                      vm.runInContext(generate(node.expression).code, innerCtx)
                    }
                    else if (t.isReturnStatement(node)) {
                      body.push(node)
                      exit = true
                    }
                    else {
                      body.push(node)
                    }
                  })
                  break
                }
                
              }
              if (!t.isReturnStatement(body[body.length - 1])) body.push(t.returnStatement())
              for (i = 0; i < node.cases.length; i++) {
                if (node.cases[i].test.value !== entry) continue
                node.cases[i].consequent[0].body = body
                break
              }
            })
            const entry_nums = entries[id]
            for (i = 0; i < node.cases.length; i++) {
              if (node.cases[i].test === null || entry_nums.includes(node.cases[i].test.value)) continue
              delete node.cases[i]
            }
            node.cases = node.cases.filter(Boolean)
            path.parentPath.parentPath.replaceWith(path)
            delete entries[id]
        }
        
    }
    
    traverse(AST, removeControlFlattening)
}

function unflattenTrickySwitchLoop(AST, entries, ctx) {
    const entry_cases = []
    const dict = {}
    const unflattenFinalControlFlow = {
        FunctionDeclaration(path) {
            const {node, scope} = path
            if (node.id.name !== Object.keys(entries)[0]) return
            path.stop()
            const param = node.params[0].name
            const body = node.body.body
            const test = generate(body[3].test).code
            const type = body[3].type
            const switch_node = body[3].body.body[0]
            const discriminant = generate(switch_node.discriminant).code
            const id = body[1].declarations[0].id.name
            const key = 'sjs_r'
            entries[node.id.name].forEach(entry => {
                vm.runInContext(`var ${param} = ${entry}`, ctx)
                vm.runInContext(generate(body[0]).code, ctx)
                vm.runInContext(generate(body[1]).code, ctx)
                vm.runInContext(generate(body[2]).code, ctx)
                var initial_index
                var exit = false
                const new_body = []
                while (!exit) {
                    if (type === 'WhileStatement' || type === 'ForStatement') {
                        if (!vm.runInContext(test, ctx)) break
                    }  

                    vm.runInContext(discriminant, ctx)
                    if (!initial_index) {
                        initial_index = ctx[id][key] + ctx[param]
                        dict[initial_index] = entry
                        entry_cases.push(initial_index)
                    }
                    for (const _case of switch_node.cases) {
                        if (_case.test.value !== (ctx[id][key] + ctx[param])) continue
                        _case.consequent[0].body.forEach(node => {
                            if (t.isExpressionStatement(node) && t.isAssignmentExpression(node.expression) && node.expression.left.name === param) {
                                vm.runInContext(generate(node.expression).code, ctx)
                            }
                            else if (t.isReturnStatement(node)) {
                                new_body.push(node)
                                exit = true
                            }
                            else {
                                new_body.push(node)
                            }
                        })
                        break
                    }
                    if (type === 'DoWhileStatement') {
                        if (!vm.runInContext(test, ctx)) break
                    } 
                }
                
                if (!t.isReturnStatement(new_body[new_body.length - 1])) new_body.push(t.returnStatement())
                for (i = 0; i < switch_node.cases.length; i++) {
                    if (switch_node.cases[i].test.value !== initial_index) continue
                        switch_node.cases[i].consequent[0].body = new_body
                        switch_node.cases[i].test.value = dict[initial_index]
                    break
                }
            })
        }
    }

    traverse(AST, unflattenFinalControlFlow)

    const removeNonEntryCases = {
        FunctionDeclaration(path) {
            const {node, scope} = path
            if (node.id.name !== Object.keys(entries)[0]) return
            path.stop()
            var cases = node.body.body[3].body.body[0].cases
            for (i = 0; i < cases.length; i++) {
                if (entries[Object.keys(entries)[0]].includes(cases[i].test.value)) continue
            delete cases[i]
            }
            node.body.body[3].body.body[0].cases = cases.filter(Boolean)

            // simplifies the the switch to be just like the other ones
            // entries can be taken from the calls right away without
            // the awkward calculation it originally does
            node.body.body = [node.body.body[3].body.body[0]]
            node.body.body[0].discriminant = node.params[0]
        }
    }

    traverse(AST, removeNonEntryCases)
}


module.exports = { prepareControlFlowUnflattening, unflattenSimpleSwitchLoops, unflattenTrickySwitchLoop }