---
title: Beam虚拟机
date: 2017-07-05
---

通过-S选项可以将erl源文件编译成汇编文件。
```
$ erlc -S test.erl
```

反编译
```
beam_lib:chunks("hw.beam", [abstract_code]).
```

## 数据区

* Code area，代码区，存放加载的编译的Erlang代码。
* stack，调用栈，保存call frames调用帧，包括局部变量以及返回地址。
* heap，堆，执行过程中创建的term。
堆和栈位于同一块内存区域的两端，向彼此的方向增长，栈从高地址向低地址增长，堆从低地址向高地址增长，这种实现使得判别内存是否溢出非常简单，只要比较一下寄存器中的两个指针的大小即可。
每个调用帧以一个返回地址CP开始，接着是局部变量。局部变量通过距离栈顶的偏移值来访问。调用帧的分配和回收通过A_op和D_op指令完成，指令后面跟调用帧的大小N。
调用帧也能包含catch的恢复地址和下一条指令的地址。

Erlang虚拟机允许调用c编译的函数，当调用编译成c的函数，下条指令地址I保存在调用帧。CP指针指向的是函数返回时恢复I指针的代码地址。

## 数据对象

一个Erlang term以一个32位的无符号数表示，分为value和tag。tag为最低位4bit，用于区分term的类型。
* 对于atom，value字段是全局atom表的索引地址。
* 对于小整数，value字段就是整数本身。
* 对于大整数，value是指向堆对象的一个指针，堆对象包含了整数的符号以及数字。
* 对于list，value是一个指针，指向两个连续的堆对象，一个头，一个尾。
* 对于tuple，指向的是堆对象，包含tuple的大小以及tuple的元素。
* 对于浮点数，指向的是一个两个字的浮点数。
* 对于pid，value就是pid本身。

```
#define SMALL          15              /* small integer       */
#define BIG            11              /* big integer pointer */
#define FLOAT           9              /* float pointer       */
#define ATOM            7              /* atom                */
#define REFER           6              /* reference           */
#define PORT            5              /* port                */
#define PID             3              /* process identifier  */
#define TUPLE           2              /* tuple pointer       */
#define NIL            (BIG + 16)      /* empty list          */
#define LIST            1              /* list pointer        */
#define ARITYVAL       10              /* tuple arity         */
#define MOVED          12              /* moved heap pointer  */
#define CATCH          THING           /* resumption address  */
#define THING          13              /* float value         */
#define BINARY         14              /* binary pointer      */
#define BLANK          ARITYVAL        /* blank local var     */
#define IC             SMALL           /* next instr. pointer */

#define CP0             0              /* CP pointer          */
#define CP4             4              /* CP pointer          */
#define CP8             8              /* CP pointer          */
#define CP12           12              /* CP pointer          */
```

由于有些数据只可能存在堆或栈中，所以同样的tag可以被两个不同的对象使用。如CATCH和THING，BLANK和ARITYVAL。

## 寄存器

* HTOP，堆顶指针
* E，栈顶指针
* CP，Continuation Pointer, 返回地址指针（函数返回后去哪里）
* PC，Program Counter，下一条执行指令地址
* I，下一个指令地址
* x(N)，1024个x寄存器，参数寄存器（用来传递函数参数），x(N)也用来保存临时变量
* y(N)，局部变量，（y(N)并不是真的寄存器，他们存在于调用帧中，通过栈顶指针的偏移值来访问）
* fcalls，reduction计数，用于进程调度

## 重要的指令

函数调用时， 把参数加载到参数寄存器x(N), 更新返回地址寄存器CP，函数返回时，返回值保存在x(0)

- test
- move ``{move, Src, Dest}``
- gc_bif
- call ``{call, Arity, {f, N}}``
 - set ``P=N, CP=Next``
 - jumps to label ``N``
 - arguments are stored in X0 ~ Xn
- return
 - does ``PC=CP``
 - return value is stored in X0
- receive
- allocate
- deallocate ``{deallocate, N}``
 - create and remove stack frames.
 - there also exists ``{allocate_zero, Ny, Ng}`` - ``Ny`` Y registers
- label ``{label, N}``
 - Nth label in the module
- function ``{function, Name, Arity, LabelID}``
 - defines a function
- bif ``{bif, FuncAtom, {f, 0}, [], {x, 0}}``
- gc_bif ``{gc_bif, '*', {f, A}, N1, [R1, R2, R3]}``
 - jumps to a function named ``'*'``
 - multiply R1 and R2, and set the result into R3. If any failure occurs jump to ``A``. If GC is triggered include N1 X registers starting at X0 in the root set for GC.
- send ``send.``
 - sends the data in ``X0`` ?
- loop_rec ``{loop_rec, {f, N}, {x, 0}}``
 - receive clause starts here, till ``loop_rec_end``
- wait_timeout ``{wait_timeout, {f, N}, {integer, T}}``
- test ``{test, is_eq_exact, {f, N}, [{x,0}, {atom, foo}]}``
- ``remove_message.``

## 并发

每个进程有自己的堆栈空间，进程执行固定数量的reduction以后挂起加入调度队列，然后调度器从队列中取出第一个进程执行。
每个进程有自己的消息队列，发消息意味着拷贝消息到目标进程的堆中，并将消息地址加入目标进程的消息队列中。
进程在等待消息的时候被交换出去，直到有新消息到来或者超时的时候重新加入调度队列。

## 参考文档

* [The Erlang BEAM Virtual Machine Specification](http://www.cs-lab.org/historical_beam_instruction_set.html)
* [How to "Build" a Computer](https://www.cs.umd.edu/class/sum2003/cmsc311/Notes/)
* [instruction set](https://github.com/erlang/otp/blob/master/lib/compiler/src/genop.tab)
* [beam_emu.c](https://github.com/erlang/otp/blob/master/erts/emulator/beam/beam_emu.c#L1103)
* [beam_opcodes.erl](https://github.com/mfoemmel/erlang-otp/blob/master/lib/compiler/src/beam_opcodes.erl)
