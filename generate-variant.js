const args = process.argv.slice(2)
const folderPath = args[0]
const projectName = args[1]
const repoUrl = args[2]
const commit = args[3]
const fs = require('fs')

const childProcess = require('child_process')

const jsonData = fs.readFileSync(`./${folderPath}/dependency-tree.json`)
const unusedFilesData = fs.readFileSync(`./${folderPath}/unused-files.txt`, 'utf-8')
const dataObj = JSON.parse(jsonData)
const unusedFiles = unusedFilesData.split('\n')

fs.writeFileSync(`./${folderPath}/wrapped-dependency-tree.json`, '')
fs.writeFileSync(`${projectName}_unused-files.txt`, '')
console.log(folderPath)

let unusedNodesSet = []
let tempArr = [] // array for a maximal subtree
let tempUnusedStack = [] // array of unused offsprings for a node
let candidates = []
let unusedDeps = []
let unusedLeaves = []
let jsonList = []
let jsonObj = {}

// let wrappedTree = {}
function convertDepTree(dataObj) {
    let wrappedTree = {}
    for (let key in dataObj) {
        wrappedTree['path'] = key
        wrappedTree['isFlaged'] = false
        wrappedTree['children'] = []
        const value = dataObj[key]
        if (isFileUnused(key)) {
            wrappedTree['isUnused'] = true
        } else {
            wrappedTree['isUnused'] = false
        }
        
        if (isFileALeaf(value)) {
            // leaf
            wrappedTree['isLeaf'] = true
            wrappedTree['isBranch'] = false
            wrappedTree['children'] = []
        } else {
            wrappedTree['isLeaf'] = false
            wrappedTree['isBranch'] = true
            // has dependencies, recursively traverse
            wrappedTree['children'] = turnValueToChildren(value, key, wrappedTree['isUnused'])
            // convertDepTree(value)
        }
    }
    return wrappedTree
}

function turnValueToChildren(value, parent, isParentUnused) {
    let children = []
    
    for (let key in value) {
        isLeaf = isFileALeaf(value[key])
        isUnused = isFileUnused(key)
        const child = {
            'path': key,
            'parent': parent,
            'isParentUnused': isParentUnused,
            'isLeaf': isLeaf,
            'isBranch': !isLeaf,
            'isUnused': isUnused,
            'isFlaged': false,
            'children': turnValueToChildren(value[key], key, isUnused)
        }
        children.push(child)

        // record parents for each json node. 
        // The reason for only recording json is that only json files can not be
        // recognized by unused-files list which is generated by stubbifier, since
        // stubbifier only records js files.
        if (key && key.slice(-5).toLocaleLowerCase() === '.json') {
            logJSON(child)
        }
    }
    return children
}

function isFileUnused(filepath) {
    return unusedFiles.indexOf(filepath) > -1 && filepath.indexOf('node_modules') > -1
}

function isFileALeaf(value) {
    return typeof value === 'object' && JSON.stringify(value) == '{}'
}

function isUnusedTree(node) {
    const children = node.children
    let childrenUnused = true

    if (children.length) {
        children.forEach(child => {
          if (!isUnusedTree(child)) childrenUnused = false
        })
        return node.isUnused && childrenUnused
    } else {
        // if a leaf is js node: check unused
        // if a leaf is json node: check in jsonList
        return isNodeUnused(node)
    }  
}

function isNodeUnused(node) {
    return node.isUnused || jsonList.indexOf(node.path) > -1
}

function LogNode(node) {
    const path = node.path
    tempArr.push(path)
    const children = node.children
    if (children.length) {
        children.forEach(child => {
            LogNode(child)
        })
    }
    return tempArr
}

function logUnusedTree(node) {
    tempArr = []
    tempArr = LogNode(node)
    unusedNodesSet.push(tempArr)
    return tempArr
}

function logJSON(node) {
    // console.log('json node', node)
    const path = node.path
    const idx = jsonList.indexOf(path)
    // if JSON's parent is unused, push it to jsonList. 
    // Otherwise, remove it from jsonList (if it's already existed in the jsonList)
    if (idx === -1 && node.isParentUnused) {
        jsonList.push(path)
    } else if (idx > -1 && !node.isParentUnused) {
        jsonList.splice(idx, 1)
    }
}


function checkNode(node) {
    // When we visit a node, we make the following two judgements.
    // 1st judgement: If the node is unused, then 2nd judgement:
    // If the subtree with this node as the root has all its nodes unused, then
    // push the subtree to candidates.
    if (node.isUnused) {
        if (isUnusedTree(node)) {
            // If all offsprings are unused files, take this subtree as a candidate
            // don't check its offsprings
            logUnusedTree(node)
            return
        } else {
            // If this unused node has used offsprings, then record all unused offsprings,
            // and take this subtree as a candidate, continue judge its offsprings.
            traverseTree(node)
        }
    }

    const children = node.children
    if (!children.length) return

    children.forEach(child => {
        checkNode(child)
    }) 
}

function traverseNode(node) {
    const path = node.path
    if (tempUnusedStack.indexOf(path) === -1) 
        isNodeUnused(node) && tempUnusedStack.push(path)
        
    const children = node.children
    if (children.length) {
        children.forEach(child => {
            traverseNode(child)
        })
    } 
    return tempUnusedStack
}

function traverseTree(node) {
    // When I traverse this node, it means this node as unused root has used offspring.
    tempUnusedStack = []
    tempUnusedStack = traverseNode(node)
    unusedNodesSet.push(tempUnusedStack)
    return tempUnusedStack
}

function collectUnusedLeaves(node) {
    if (isNodeUnused(node)) {
        const path = node.path

        // log unused leaves
        if ((node.isLeaf || jsonList.indexOf(path) > -1) && unusedLeaves.indexOf(path) === -1) {
            unusedLeaves.push(path)
            fs.appendFileSync(`${projectName}_unused-leaves.txt`, path + '\n')
        }      
    
        // log unused dependencies
        const pathArr = path.split("/")
        const nodeMIdx = pathArr.indexOf("node_modules")
        const depName = pathArr[nodeMIdx + 1]
        if (unusedDeps.indexOf(depName) === -1) {
            unusedDeps.push(depName)
        }
    }
    const children = node.children
    if (!children.length) return

    children.forEach(child => {
        collectUnusedLeaves(child)
    })
}

function generateVariant(files, index) {
    // console.log(JSON.parse(candidate))
    // copyProject:
    const variantPath = `Variants/${projectName}/variant${index + 1}/${projectName}`
    console.log('start generating ', variantPath)
    childProcess.exec(`git clone ${repoUrl} ${variantPath} && cd ${variantPath} && git checkout ${commit} && npm install --force && cd ../../.. `,
        (err, stdout, stderr) => {
            if(err) console.log(err)
            // the stdout is a buffer(binary format), toString() to encode utf8
            console.log(stdout.toString())
        }
    )

    // Change names for files in candidate
    const newfiles = files.map(file => {return file.replace(`${folderPath}`, `${variantPath}`)})
    newfiles.forEach(file => {
        // file = file.replace(`${folderPath}`, `${variantPath}`)
        console.log(file)
        const fileStr = file + '\n'
        fs.appendFileSync(`${projectName}_unused-files.txt`, fileStr)
    })
}




// Convert dependency-tree to wrapped-tree. For each node in dependency-tree, 
// generate a new node with path, isLeaf, isUnused, isBranch, children
const result = convertDepTree(dataObj)

fs.writeFileSync(`./${folderPath}/wrapped-dependency-tree.json`, JSON.stringify(result))


checkNode(result)

unusedNodesSet.forEach(set => {
    str = JSON.stringify(set)
    if (candidates.indexOf(str) == -1) {
        candidates.push(str)
    }
})

console.log('Candidates on the tree:')
const branchStr = `Number of bloated branches in ${projectName}: ${candidates.length} \n\n`
fs.appendFileSync(`${projectName}_unused_branches.txt`, branchStr)

candidates.forEach((candidate, index) => {
    const files = JSON.parse(candidate)
    console.log(files)
    fs.appendFileSync(`${projectName}_unused_branches.txt`, candidate + '\n')
    generateVariant(files, index)
    jsonObj[`variant${index + 1}`] = {
        "files": files,
        "fileNum": files.length
    }
})


fs.writeFileSync(`${projectName}_variants.json`, JSON.stringify(jsonObj))

collectUnusedLeaves(result)

unusedDeps.forEach(dep => {
    fs.appendFileSync(`${projectName}_unused_deps.txt`, dep + '\n')
})


// combSet = candidates.map(set => JSON.parse(set))

// const candidatesComb = ACGParseUtils_js_1.getCombinations(combSet)
// console.log('Combinations of the candidates:')
// console.log(candidatesComb.length)

// // Randomly select a seed to remove and generate a variant

// var variantsLength = candidatesComb.length
// console.log('variantsLength: ', variantsLength)
// var fileRand = ~~(Math.random() * variantsLength)
// console.log("file rand: ", fileRand)
// var fileVariants = candidatesComb[fileRand]
// console.log('fileVariants: \n', fileVariants)
