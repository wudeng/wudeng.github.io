#!/bin/bash

SRC="../data"
DST="../publish"
TARGET="_null"

# loop markdown data
function cook()
{
    if [[ $TARGET = "all" ]]; then
        echo -e "start to cook all...\n"
        for data in $(ls $SRC/*.md)
        do
            if [ -f "$SRC/$data" ]; then
                TARGET="$SRC/$data"
                cook $TARGET
            fi
        done
    else
        if [[ -f "$TARGET" ]]; then
            node build.js --source $TARGET
        else
            echo -e "$TARGET not found fail\n"
        fi
    fi
}

# argument --> target
while getopts "d:ahi" arg
do
    case $arg in
        d) TARGET=$OPTARG
           ;;
        a) TARGET="all"
           ;;
        h) echo -e "usage:\n\t./build.sh <-d target> <-a all> <-h>"
           exit 1
           ;;
        *) echo -e "usage:\n\t./build.sh <-d target> <-a all> <-h>"
           exit 1
           ;;
    esac
done

if [[ $TARGET = "_null" ]]; then
    echo -e "target not set fail."
    echo -e "usage:\n\t./build.sh <-d target> <-a all> <-h>"
    exit 1
fi

cook

