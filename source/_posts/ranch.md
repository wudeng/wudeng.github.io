---
title: Ranch源码分析
date: 2017-09-07
---

Ranch是一个TCP连接管理开源库，从著名的cowboy开源库中剥离出来的。
本文对ranch的重要模块一一进行解读，来品味一下这个优雅小巧而又功能强大的TCP管理库。
本文基于ranch的1.0版本。

## ranch

提供对外接口。最重要的接口是start_listener和stop_listener。需要指定一个唯一的名字Ref，
socket处理模块以及参数，协议处理回调模块及参数。这个函数会将整个监控树启动起来。
Ref是负责处理这个端口连接的监控树的名字，有了这个名字就可以对这颗监控树执行一些操作，
比方说停止监听端口、设置连接上限等。

```
start_listener(Ref, NbAcceptors, Transport, TransOpts, Protocol, ProtoOpts) -> {ok, Pid} | {error, badarg}
stop_listener(Ref) -> ok | {error, not_found}
```

## ranch_sup

根监控树。启动ranch_server进程以及ranch_listener_sup监控树。
其中ranch_server是启动application的时候就会启动，而ranch_listener_sup则是开始监听的时候动态启动的。
启动ranch_listener_sup需要提供各种参数，而且支持启动多个实例。

## ranch_server

是个打杂的进程，主要提供一些获取、修改参数的接口。主要数据都保存在ranch_server这个ets表中。
进程重启的时候也会ets表中恢复出进程状态。所以这个ets表的宿主进程并不是这个进程本身，而是ranch_sup。
即使这个进程崩溃，也不会丢失ets表的数据。
* {max_conns, Ref}: MaxConns
* {opts, Ref}: Opts
* {conns_sup, Ref}: Pid
* {addr, Ref}: Addr

## ranch_listener_sup

监控进程，负责启动ranch_conns_sup以及ranch_acceptors_sup两个监控树。
因为没有注册名字，ranch_listener_sup监控树可以启动多个实例，一般来说，每一个监听的端口对应一个监控树。
这些监控树都挂在ranch_sup下面。

## ranch_acceptors_sup

也是监控树，开始监听端口，并启动NbAcceptors个数的accept进程来接收socket接请求。
这个进程拥有监听socket的所有权。

## ranch_transport

定义操作socket的接口。如listen,accept,recv,send,shutdown,close等。
ranch实现了两个数据传输协议，tcp和ssl。分别由ranch_tcp和ranch_ssl实现。
可以这么理解，在面向对象世界里，ranch_transport对应接口，ranch_tcp和ranch_ssl对应接口的具体实现。

## ranch_tcp

实现ranch_transport定义的接口，主要是封装了gen_tcp的一些基本操作。
监听socket的属性分类两类，一类是可以设置的，一类是默认的。
* 可设置的包括：backlog,ip,linger,nodelay,port,raw,send_timeout,send_timeout_close
* 默认的包括：binary,{active,false},{packet,raw},{reuseaddr,true},{nodelay,true}

可以看出，binary,{active,false},{packet,raw},{reuseaddr,true}这几个是写死了无法通过传入参数来改变的。

## ranch_ssl

实现ranch_transport定义的接口，主要是封装了ssl的一些基本操作。

## ranch_acceptor

ranch_accept接收到连接请求以后，将socket控制权转交ranch_conns_sup，
同时通知ranch_conns_sup启动连接处理进程，处理此socket的数据收发。
ranch_conns_sup启动连接进程以后，accept进程继续accept新的连接。如果由于某些原因（比如连接数达到上限）
连接进程没有启动起来，那么accept进程就会阻塞在这里，无法继续接收连接，直到连接进程启动起来为止。
如果系统文件句柄消耗完毕，accept进程会等待100ms才继续接收连接请求。
如果监听socket关闭了，那么accpet进程会因为匹配不到消息崩溃退出。
因为监听socket使用了active,false选项，在socket的宿主进程主动recv之前，宿主进程不会收到来自socket的数据。
所以accept进程以及随后的ranch_conns_sup进程都不会收到socket的数据，从而保证连接进程接收到的数据是完整的。
不过为了防止意外情况（比如socket用了active其他选项）导致accpet进程收到了其他消息，
accpet进程会在进入下一次accpet前清空一下消息队列。

## ranch_conns_sup

连接进程的管理进程，负责连接进程的启动。作为ranch_listener_sup的子进程之一，这个进程启动时会想ranch_server注册自己。
这样后续启动的ranch_acceptors_sup就能拿到连接管理进程，可以作为参数传递给ranch_acceptor进程，以便后者收到连接请求是启动连接进程。
这是一个特殊进程，也就是用proc_lib来启动的进程，并且会处理system消息，这个进程同时具有gen_server和supervisor的功能。
在作者的书<<The Erlanger Playbook>>中第一章就讲到了特殊进程，以及为什么我们要用特殊进程。这个进程就是一个非常好的例子。

这个进程收到socket发送的启动连接进程消息以后，启动连接进程，将socket控制权转交连接进程，并通知连接进程开始进行数据收发。

此进程会将连接进程Pid存入进程字典，并维护连接进程的数量。
如果数量达到上限，则暂时不回复accept进程，而是将accept进程存入Sleeper列表中。这将导致accept进程阻塞在receive语句中，
无法继续accept连接。如果还没有到上限，则立即回复accept进程，accept进程收到回复就可以继续accpet连接了。
所以达到配置的连接数量上限以后，实际上我们的还能创建NbAcceptors个连接进程，然后所有accept进程都阻塞在receive过程，
不会继续接收socket连接。

如果启动连接进程失败了，那么这个进程需要回复accpet进程，防止accept阻塞在receive语句，同时关闭socket连接，并打印错误日志。

这个进程trap_exit标记值为true，连接进程通过start_link创建，所以当连接进程正常或者异常退出时，
这个进程能收到`{'EXIT',Pid,Reason}`消息，方便我们维护连接子进程。
这时候如果还有阻塞的accept进程即Sleeper，则会取出一个来回复，然后这个accpet进程就能继续接收连接请求了。

ranch_conns_sup进程是作为ranch_listener_sup监控下的进程启动的，而且它启动的type是supervisor。
所以他需要向它的父进程提供supervisor的功能，主要是以下几点：
* which_children
* count_children
* shutdown子进程。包括强制退出，以及等待超时退出。父进程退出时，或者系统退出时，等待通知子进程退出，超时后强制kill子进程。

不过它并不需要向子进程提供supervisor功能，就算子进程异常退出，它也不会尝试重启子进程，因为没有这个必要。
关闭子进程时，先monitor，再unlink，再调用exit发退出消息。先unlink是防止子进程退出时又一次收到EXIT消息。
```
terminate(#state{shutdown=brutal_kill}, Reason, _) ->
	Pids = get_keys(true),
	_ = [begin
		unlink(P),
		exit(P, kill)
	end || P <- Pids],
	exit(Reason);
terminate(#state{shutdown=Shutdown}, Reason, NbChildren) ->
	shutdown_children(),
	_ = if
		Shutdown =:= infinity ->
			ok;
		true ->
			erlang:send_after(Shutdown, self(), kill)
	end,
	wait_children(NbChildren),
	exit(Reason).

shutdown_children() ->
	Pids = get_keys(true),
	_ = [begin
		monitor(process, P),
		unlink(P),
		exit(P, shutdown)
	end || P <- Pids],
	ok.

wait_children(0) ->
	ok;
wait_children(NbChildren) ->
	receive
        {'DOWN', _, process, Pid, _} ->
			_ = erase(Pid),
			wait_children(NbChildren - 1);
		kill ->
			Pids = get_keys(true),
			_ = [exit(P, kill) || P <- Pids],
			ok
	end.
```
值得一提的还有子进程的存储方式，这里使用了进程字典的get_keys接口来获取所有子进程。如果shutdown指定了超时时间，
那么就会通过一个定时器来触发kill消息，将所有尚未退出的子进程调用`exit(Pid, kill)`强行退出。


## 连接进程(ranch_protocol的具体实现)
ranch_protocol定义了启动连接进程的接口。只有一个接口：
```
start_link(Ref, Socket, Transport, ProtocolOptions) -> {ok, Pid}
```
实现这个接口的模块用来处理建立连接以后的数据收发，start_link函数创建一个进程用来处理协议数据。
注意这里只能是start_link，意味着父进程（即ranch_conns_sup进程）和创建的进程之间有link的关系。
这个要求跟supervisor要求子进程创建函数必须是start_link是一致的。
因为supervisor进程就是依靠link关系来管理子进程的。

父进程ranch_conns_sup借助link关系来监控连接进程的退出状态，借此维护连接的数量，然而并不会重启子进程。

Ranch并没有提供这个模块的默认实现。我们利用ranch实现自己功能的时候，首先就需要实现这个接口，来处理数据收发的逻辑。
然后将其作为参数传入启动监听过程的函数中，即start_listener中的Protocol参数。

这里就是我们要实现的逻辑所在了。首先要实现ranch_protocol的start_link/4接口，以便ranch_conns_sup调用。
通常这里都是spwan_link一个进程出来，返回。在进程进入循环之前调用`ranch:accept_ack(Ref)`等待ranch_conns_sup通知我们，
socket已经转移控制权，然后就可以进入循环进行消息接收和处理了。

如果要用gen_server来实现连接进程，我们就要注意了。因为我们需要先返回{ok, Pid}到ranch_conns_sup进程，
然后等待ranch_conns_sup进程给我们发消息，通知我们shoot，才能进入消息循环。
（这是因为连接进程的消息循环一般会将socket的active由false改成once，如果ranch_conns_sup还没有将控制权转交过来就调用了set_opts,
那么ranch_conns_sup就可能会收到来自socket的消息。所以我们需要确保已经转移了控制权才能够进入消息循环。[参考](http://santtu.iki.fi/2014/03/06/network-and-parallelism-in-erlang)）
如果我们直接用gen_server:start_link来启动这个连接进程，
就会出现了一个困境：首先，ranch_conns_sup需要start_link返回Pid以后才能通知连接进程就绪，而连接进程需要接收到通知才能从init中返回。
这样就出现死锁了。解决的方法主要有两种：

* 一种是在主循环来接收shoot消息，比如init返回一个{ok, Pid, 0}，那么进入循环后第一条处理的就是handle_info(timeout),
我们可以在这里接收shoot消息，设置socket选项等。

* 要么使用其他proc_lib方法来启动进程，比如proc_lib:start_link/3，然后在初始化的时候直接通过
proc_lib:init_ack({ok, self()})来向父进程返回Pid，然后等待父进程的shoot消息。

个人更倾向于第二种方式。因为shoot消息是一次性的，更适合在初始化的时候搞定，而不是放在主循环里面。

```
start_link(Ref, Socket, Transport, Opts) ->
	proc_lib:start_link(?MODULE, init, [Ref, Socket, Transport, Opts]).

init(Ref, Socket, Transport, _Opts = []) ->
	ok = proc_lib:init_ack({ok, self()}),
	ok = ranch:accept_ack(Ref),
	ok = Transport:setopts(Socket, [{active, once}]),
	gen_server:enter_loop(?MODULE, [],
		#state{socket=Socket, transport=Transport},
		?TIMEOUT).
```

## 源码
* https://github.com/ninenines/ranch
* https://git.ninenines.eu/ranch.git/plain/CHANGELOG.asciidoc
