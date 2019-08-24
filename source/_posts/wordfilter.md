---
title: 敏感词过滤
date: 2018-04-13
---

## DFA

Deterministic Finite Automation 确定有穷自动机。
我理解其实就是一个简单的Trie树，节点带output，对于结束的节点，把对应的字符串写在output里面。
对于字符串中的每个字符，查找Trie树中能否走到有单词结束标记的节点。匹配失败的话需要回退。

## AC自动机

Aho-Corasick算法，在Trie树的基础上加入了fail指针。Unix工具fgrep的底层实现就是用的AC自动机。

每条边代表一个字符。同一个节点出来的边代表的字符各不相同。每个节点代表一个状态。
状态的迁移由三个函数决定：goto，failure，output。而failure函数是AC自动机最难也是最关键的一环。

假设有字符串ABCDE匹配到模式ABC，结果D没匹配上。这说明模式ABCD是不可能的了。这时候按照传统的算法，
应该从字符串中A的下一个字符也就是B开始重新从根节点进行匹配。但是我们已经知道了B后面是CD，
最好的情况就是模式中刚好有BCD开头的这个模式，我们一路匹配到BCD。那么如果我们能直接从ABC的C跳到BCD这个D节点就好了。
failure指针就是干这个的。如果BCD模式也没有，那么我们就退而求其次看看有没有CD，没有CD，那就直接看D，如果都没有，
那D也不用看了，直接从根节点匹配E吧。失败指针构造就是这么个递归的查找过程，这其中包含了动态规划的思想。
实际构造失败指针的时候，父节点的失败指针是一层层已经构造好了的，所以其实就是一个自底向上的动态规划过程。
简单的说失败指针就是用当前模式的后缀去匹配其他模式的前缀。失败指针代表的字符跟节点本身要么是一样的，
要么是空（也就是根节点）。

node: children, output, fail point
* build a trie tree with output, when finish, every node only has one output
* build fail point
  - root node's children fail to the root, add children to a fifo queue
  - pop one node out of queue, build fail point for children of that node
    - for every child, find the closest children, starting from the fail node,
        check if it has the character of the child node ?
      - if true, then point to that node, add the failed node's output to the current node
      - if false, fail to the root
    - node in queue, already build fail node
* match
  - if fail, go to the fail node, and continue the match

构造失败指针这部分比较麻烦一点。思路是从父节点的fail node开始，递归的往上找fail node，
看fail node的子节点是否有包含当前节点相同字符的节点，如果有，将该子节点设为当前节点的
fail节点，并且将fail节点的output也加到当前节点的output列表中。如果没有，一路递归到根节点。
构造的过程是一层层往下的，所以处理低层的节点的时候高层的节点都已经处理好了。
其实就是一个宽度优先的遍历。

匹配的时候从根节点开始往下找，匹配失败就递归的往上找失败节点。匹配失败目标字符串不需要回退。
类似KMP的匹配，所以效率很高。

## Erlang实现AC自动机

在[这里](https://github.com/josemic/ahocorasick.git)找到了一个erlang版本的ac自动机，
可惜是一个不完整的版本，因为失败指针没有正确的构建，所以有些情况下不能正确匹配。
比如：词库中有"BC"、"ABCD"这两个违禁词，但是尝试匹配"ABC"的时候发现匹配不到。
而正常的AC自动机是能够匹配上的。这是因为这里的自动机少了第二步，构造失败指针，
这样失败指针指向的节点的output也不会加入到当前节点。所以出现上面的问题。

自己撸了一个Erlang版本的AC自动机，用了map结构，代码很精简，一百来行，基本比较完整实现了
功能，包括失败指针的构造，[代码](https://github.com/wudeng/aho-corasick.git)放在github上了。
对比了一下之前用re正则模块一个个匹配的方法，AC的性能提升超过1000倍。

## binary模块

> 众里寻他千百度，蓦然回首，那人却在灯火阑珊处。

AC自动机的实现有各种语言的版本，唯独Erlang的非常少。
找到一个纯Erlang实现的还只是实现了一部分。最关键的fail函数没有实现。导致匹配的时候
会出现上面的问题。

其实Erlang已经为我们实现了一个AC自动机，就在binary模块中。通过这个模块
的源码`erl_bif_binary.c`可以看到这样一段注释：
``` c
/*
 * The native implementation functions for the module binary.
 * Searching is implemented using either Boyer-Moore or Aho-Corasick
 * depending on number of searchstrings (BM if one, AC if more than one).
 * Native implementation is mostly for efficiency, nothing
 * (except binary:referenced_byte_size) really *needs* to be implemented
 * in native code.
 */
```
可以看出binary的搜索是基于BM和AC算法来实现的。如果模式只有一个就是BM，如果有多个就是AC。因此要实现替换功能，
只需要直接调用`binary:replace(Subject, Pattern, Replacement, Options)`方法即可。
另外binary还提供了一个`binary:compie_pattern(Pattern)`函数，这样可以把模式存储下来，
后续的匹配直接使用即可。不过这里每个节点其实不是一个有效的utf8字符，而只是一个字节。

```erlang
Cp = binary:compile_pattern(Patterns),
io:format("~ts",[binary:replace(Text,Cp,<<"*">>,[global])]).
```

### 参考文档

* https://blog.csdn.net/liangrui1988/article/details/44873331 Java实现
* https://github.com/importcjj/sensitive 就是一个简单Trie树，DFA
* https://github.com/gonet2/wordfilter go
* https://github.com/observerss/textfilter python
* https://github.com/toolgood/ToolGood.Words
* http://www.hankcs.com/program/algorithm/aho-corasick-double-array-trie.html
* https://github.com/anknown/ahocorasick go ac
* http://www.cs.uku.fi/~kilpelai/BSA05/lectures/slides04.pdf
