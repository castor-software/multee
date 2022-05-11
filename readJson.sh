jsonlist=$(jq -r '.projects' "repoSet.json")
# inside the loop, you cant use the fuction _jq() to get values from each object.
for row in $(echo "${jsonlist}" | jq -r '.[] | @base64')
do
    _jq()
    {
        echo ${row} | base64 --decode | jq -r ${1}
    }
    repoUrl=$(_jq '.gitURL')
    entryFile=$(_jq '.entryFile')
    folderPath="Playground/"$(_jq '.folder')

    rm -rf $folderPath

    git clone $repoUrl $folderPath

    ./resetProject.sh $folderPath

    python3 genDepList.py $folderPath "npm install "

    python3 genNycRc.py $folderPath "${folderPath}/dep_list.txt"

    cd $folderPath

    nyc npm run test

    cd ../..

    ./transform.sh $folderPath "dynamic" false

    npm install --save dependency-tree

    node dep-tree.js $folderPath $entryFile

    node traverse-tree.js  $folderPath


done