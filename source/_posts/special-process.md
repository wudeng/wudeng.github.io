---
title: Erlang特殊进程
date: 2017-09-09
---

特殊进程是通过proc_lib来启动的进程，并实现了system消息处理进程。
包括但不限于常用的gen_server, gen_statem, gen_event等标准Behavior。

## 为啥自己实现

虽然Behavior很好很强大，可以满足绝大部分的需求，但是它们也存在缺点，那就是过于通用。为了达到通用的目的，
标准Behavior包含了大量处理边界条件的逻辑，一般情况下不会成为问题，但是当你的进程成为瓶颈的时候，可能需要考虑自己实现一个。
比方说：

* 有一个supervisor进程监控大量work进程，还有另一个gen_server进程来控制work的数量，那么这两个进程有一些工作是重复的。
* 有一个gen_server只会被local进程使用到，但是他包含了大量call，那么通用的call机制可能成为瓶颈。

## 为啥不用普通进程

除了一些需要异步进行的临时任务，尽量不要使用普通进程。特殊进程可以为你提供：

* 告诉你哪个进程是它的父进程
* 父进程退出时优雅的退出
* 异常退出时生成log
* 能够查看或者替换进程状态

这些好处值得多花几分钟来实现。

## 如何实现

特殊进程必须通过proc_lib和sys来实现。

### proc_lib

通过proc_lib启动的进程总是会把两个信息写入进程字典：

* $ancestors
* $initial_call

这两个信息被各种调试工具用到。如果开启了SASL，那么proc_lib启动的进程崩溃的时候会生成崩溃日志。
```
$ erl -boot start_sasl
...
1> proc_lib:spawn_link(fun() -> 1 = 2 end).
=CRASH REPORT==== 8-Sep-2017::17:05:42 ===
  crasher:
    initial call: erl_eval:-expr/5-fun-1-/0
    pid: <0.43.0>
    registered_name: []
    exception error: no match of right hand side value 2
    ancestors: [<0.41.0>]
    messages: []
    links: [<0.41.0>]
    dictionary: []
    trap_exit: false
    status: running
    heap_size: 233
    stack_size: 27
    reductions: 97
  neighbours:
    neighbour: [{pid,<0.41.0>},
                  {registered_name,[]},
                  {initial_call,{erlang,apply,2}},
                  {current_function,{io,wait_io_mon_reply,2}},
                  {ancestors,[]},
                  {messages,[]},
                  {links,[<0.26.0>,<0.43.0>]},
                  {dictionary,[]},
                  {trap_exit,false},
                  {status,waiting},
                  {heap_size,610},
                  {stack_size,29},
                  {reductions,1161}]
** exception exit: {badmatch,2}
```
从上面log可以看到父进程以及初始函数都出现在崩溃日志中。
最后，用pro_lib还提供一个可选的特征，使用确认函数来同步启动进程。

### sys

通过proc_lib启动的进程必须实现sys协议。
sys能够为你的进程带来更多调试以及跟踪机制。

* sys:get_status/1
* sys:get_state/1
* sys:replace_state/2

除此之外，实现sys协议的进程还能够暂停以及恢复。

### 异步启动

- 通过proc_lib:spawn_link/1..4或者proc_lib:spawn_opt/2..5启动进程。
- 写一个receive的循环。
- 父进程退出时退出，这意味着如果trap exit消息，需要处理父进程退出消息。
- 处理系统消息。
- 实现system_continue/3, system_terminate/4, system_code_change/4回调函数。

```
start_link() ->
    proc_lib:spawn_link(?MODULE, init, [self()]).
init(Parent) ->
    loop(Parent).
loop(Parent) ->
    receive
        %% Only required when trap_exit is enabled.
        {’EXIT’, Parent, Reason} ->
            terminate(State, Reason, NbChildren);
        {system, From, Request} ->
            sys:handle_system_msg(Request, From, Parent, ?MODULE, [], {state, Parent});
        Msg ->
            error_logger:error_msg("Unexpected message ~p~n", [Msg]),
            loop(Parent)
    end.
system_continue(_, _, {state, Parent}) ->
    loop(Parent).
system_terminate(Reason, _, _, _) ->
    exit(Reason).
system_code_change(Misc, _, _, _) ->
    {ok, Misc}.
```

### 同步启动

- 使用proc_lib:start_link/1..4启动进程
- 在进入循环之前调用proc_lib:init_ack/1
- 其他跟异步启动类似

```
start_link() ->
    proc_lib:start_link(?MODULE, init, [self()]).
init(Parent) ->
    ok = proc_lib:init_ack(Parent, {ok, self()}),
    loop(Parent).
loop(Parent) ->
    receive
        %% Only required when trap_exit is enabled.
        {’EXIT’, Parent, Reason} ->
            terminate(State, Reason, NbChildren);
        {system, From, Request} ->
            sys:handle_system_msg(Request, From, Parent, ?MODULE, [],
                                  {state, Parent});
        Msg ->
            error_logger:error_msg("Unexpected message ~p~n", [Msg]),
            loop(Parent)
    end.
system_continue(_, _, {state, Parent}) ->
    loop(Parent).
system_terminate(Reason, _, _, _) ->
    exit(Reason).
system_code_change(Misc, _, _, _) ->
    {ok, Misc}.

```

## Call

OTP的call实现考虑了很多特殊情况，整个实现非常复杂。

```
do_call(Process, Label, Request, Timeout) ->
    try erlang:monitor(process, Process) of
	Mref ->
	    %% If the monitor/2 call failed to set up a connection to a
	    %% remote node, we don't want the '!' operator to attempt
	    %% to set up the connection again. (If the monitor/2 call
	    %% failed due to an expired timeout, '!' too would probably
	    %% have to wait for the timeout to expire.) Therefore,
	    %% use erlang:send/3 with the 'noconnect' option so that it
	    %% will fail immediately if there is no connection to the
	    %% remote node.

	    catch erlang:send(Process, {Label, {self(), Mref}, Request},
		  [noconnect]),
	    receive
		{Mref, Reply} ->
		    erlang:demonitor(Mref, [flush]),
		    {ok, Reply};
		{'DOWN', Mref, _, _, noconnection} ->
		    Node = get_node(Process),
		    exit({nodedown, Node});
		{'DOWN', Mref, _, _, Reason} ->
		    exit(Reason)
	    after Timeout ->
		    erlang:demonitor(Mref, [flush]),
		    exit(timeout)
	    end
    catch
	error:_ ->
	    %% Node (C/Java?) is not supporting the monitor.
	    %% The other possible case -- this node is not distributed
	    %% -- should have been handled earlier.
	    %% Do the best possible with monitor_node/2.
	    %% This code may hang indefinitely if the Process
	    %% does not exist. It is only used for featureweak remote nodes.
	    Node = get_node(Process),
	    monitor_node(Node, true),
	    receive
		{nodedown, Node} ->
		    monitor_node(Node, false),
		    exit({nodedown, Node})
	    after 0 ->
		    Tag = make_ref(),
		    Process ! {Label, {self(), Tag}, Request},
		    wait_resp(Node, Tag, Timeout)
	    end
    end.
```
我们自己实现的时候可以去掉那些特殊情况，针对我们自己的情况优化冗余的检查和逻辑。
比如，我们没有注册名字，就不需要解析名字；如果没有用到C或者Java节点，可以去掉处理这部分的代码。

## 实例

参考ranch的ranch_conns_sup模块。很经典的例子。

## 参考文档

* [The Erlanger Handbook](https://ninenines.eu/res/erlanger-preview.pdf)
* Ranch
