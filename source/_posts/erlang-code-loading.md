---
title: Erlang代码加载模式
date: 2017-07-15
---

Erlang自带三个Boot脚本：
- start_clean.boot 加载和启动Kernel和STDLIB
- start_sasl.boot 比上面多了一个SASL
- no_dot_erlang.boot 跟第一个一样，只是不加载`.erlang`
安装otp的时候可以选择默认脚本是start_clean还是start_sasl，选择以后会拷贝一份start.boot.

ERTS中有两种代码加载模式：
* interactive：代码第一次被引用的时候会去代码路径中搜索并加载。
* embedded：一开始就根据boot script来加载。

code模块对外提供接口，code_server模块处理实际的工作，注册为code_server。维护一个私有ets表code。
预加载的10个模块，包括erlang_prim_loader，erlang，init，prim_inet，prim_file等模块，需要被code_server用到的模块都属于预加载。
```
(dev@127.0.0.1)1> erlang:pre_loaded().
[erts_internal,erlang,erl_prim_loader,prim_zip,zlib,
 prim_file,prim_inet,prim_eval,init,otp_ring0]
```
对于预定义的模块，如lists，math等等系统模块，这些模块是不能重复热更新的。这些模块所在的目录被称为`sticky`目录。
这是为了防止有人误操作把系统模块给替换了导致整个系统崩溃。除了这些系统模块，其他的模块都是可以热更新的。

ERTS系统中，一个模块可以存在两个版本。新版本(current)和老版本(old)，两个版本都是有效的。
代码第一次加载进来的时候是新版本，当有新的代码加载的时候，新的代码变成新版本，原来的新版本变成老版本。
当有第三个版本加载进来的时候，之前的老版本就需要被移除掉(purge)，
这样如果有进程还在执行老版本的代码，需要将这些还在执行老代码的进程杀死才能进行热更。杀死运行老代码然后purge老代码，然后加载最新代码，这是系统默认的热更方式。
所以一般情况下，第一次热更新模块的时候是安全的，因为系统只有一个新版本的代码。第二次热更新如果使用强制更新就可能杀死一些进程，引发一些意想不到的后果。
要避免这种情况，一方面是在调用代码的时候使用全名函数，一方面在热更新的时候使用软更新(soft purge)。这样如果还有进程在执行老代码，就不会执行热更新。
OTP框架下的模板都是支持热更新的。

## purge

purge：是指将老版本的代码从系统中移除掉，如果仍有进程在执行老版本代码，则将这些进程杀掉。
soft_purge：尝试将老代码移除掉，如果仍有进程在执行老版本代码，则返回失败。

erlang模块提供的接口：
- erlang:check_old_code(Mod) -> boolean(). 检查系统中是否存在该模块的老代码。当系统中有老代码的时候，要清除老代码（执行purge）才能加载新的代码。
  为了清除老代码要先找到仍在执行老代码的进程，将其kill掉。

- erlang:check_process_code(Pid, Mod) -> boolean(). 检查进程是否在执行Mod的老代码。
  为了找出仍在执行老代码的进程，需要遍历进程列表processes()，依次进行检查。

进程仍在执行模块的老代码，有三种情况：
* 进程正在执行老代码。这种情况下是不管进程调用的全名函数短名函数。对于全名函数，当前这次执行完了下次就会切换到新代码，所以一开始返回true，后面就false了。对于短名函数则始终为true。
* 进程包含短名函数的引用。
* 进程包含引用短名函数的fun对象。比如其他模块发送了一个fun给进程执行，这个fun对象包含了模块的短名对象，那么执行fun对象期间返回true。

如果一个常驻内存的进程拿到了一个模块构造的匿名函数，那么这个模块要热更的时候就比较麻烦了。可能必须得杀死这个常驻进程才能purge模块的老代码。
在实际工作过程中如果对热更机制缺乏了解就会犯这样的错误。在实现战斗技能的时候，前端要求如果技能杀死对象要统一结算。所以一开始实现的时候会
被杀死的对象的处理函数写成匿名函数然后存到地图进程的进程字典。结果发现有时候战斗的逻辑无法热更（因为我们热更线上的代码都是采用soft_purge，不会强制杀死进程）。

还有一个例子就是实现玩法活动的时候，管理进程会创建一些回调函数到场景进程，这些回调函数的参数一部分由管理进程提供，一部分由地图进程提供，写成匿名函数的话非常方便。
但是这样的话导致活动期间活动的逻辑代码无法热更。因为要热更就必须杀死场景进程。因此这种做法应该是尽量避免的。

检查系统中的老代码：
```
f(OldMods),OldMods = lists:filtermap(
    fun({Module, Filename}) ->
        is_list(Filename) andalso
        erlang:check_old_code(Module) andalso
        {true, Module}
    end,
    code:all_loaded()
).
```
检查系统中老代码无法被purge的模块：
```
lists:filtermap(
    fun(Module) ->
        not code:soft_purge(Module)
    end,
    OldMods
).
```
找出还在执行老代码Mod的进程信息：
`[process_info(Pid)||Pid<-processes(),erlang:check_process_code(Pid, Mod)].`



杀进程。一般先monitor，再kill，等待接收moniter消息，确认当前进程杀死。因为被杀死的进程可能需要进行一些清理的行为，如果不等待它确认死亡就将执行后续操作如移除代码，可能会导致清理过程出现找不到代码的问题。

code_server中杀死进程的过程：

```
%% do_purge(Module)
%%  Kill all processes running code from *old* Module, and then purge the
%%  module. Return true if any processes killed, else false.

do_purge(Mod0) ->
    Mod = to_atom(Mod0),
    case erlang:check_old_code(Mod) of
	false -> false;
	true -> do_purge(processes(), Mod, false)
    end.

do_purge([P|Ps], Mod, Purged) ->
    case erlang:check_process_code(P, Mod) of
	true ->
	    Ref = erlang:monitor(process, P),
	    exit(P, kill),
	    receive
		{'DOWN',Ref,process,_Pid,_} -> ok
	    end,
	    do_purge(Ps, Mod, true);
	false ->
	    do_purge(Ps, Mod, Purged)
    end;
do_purge([], Mod, Purged) ->
    catch erlang:purge_module(Mod),
    Purged.
```

直接purge有杀死进程的危险性，所以code_server也提供了soft_purge，如果有进程仍在执行老代码，则不移除老代码。
```
%% do_soft_purge(Module)
%% Purge old code only if no procs remain that run old code.
%% Return true in that case, false if procs remain (in this
%% case old code is not purged)

do_soft_purge(Mod) ->
    case erlang:check_old_code(Mod) of
	false -> true;
	true -> do_soft_purge(processes(), Mod)
    end.

do_soft_purge([P|Ps], Mod) ->
    case erlang:check_process_code(P, Mod) of
	true -> false;
	false -> do_soft_purge(Ps, Mod)
    end;
do_soft_purge([], Mod) ->
    catch erlang:purge_module(Mod),
    true.
```

## 热更机制

在开发环境中，可以使用Mochiweb的reloader模块来进行热更。reloader的实现机制主要是每隔一秒钟检测一次系统中加载的代码对应的beam文件时间戳，
如果发现时间戳从上次检测以来发生了变更，就执行热更新。在开发中使用起来非常方便。我们只需要编译代码，系统自动进行加载。
但是reloader的热更新用的是purge，也就是说如果你的进程持有热更模块的匿名函数引用，或者不符合otp规范，比如进程的主循环用的是短名函数，那么就存在进程被杀死的风险。
reloader的核心代码如下：
```
doit(From, To) ->
    [case file:read_file_info(Filename) of
         {ok, #file_info{mtime = Mtime}} when Mtime >= From, Mtime < To ->
             reload(Module);
         {ok, _} ->
             unmodified;
         {error, enoent} ->
             %% The Erlang compiler deletes existing .beam files if
             %% recompiling fails.  Maybe it's worth spitting out a
             %% warning here, but I'd want to limit it to just once.
             gone;
         {error, Reason} ->
             io:format("Error reading ~s's file info: ~p~n",
                       [Filename, Reason]),
             error
     end || {Module, Filename} <- code:all_loaded(), is_list(Filename)].

reload(Module) ->
    io:format("Reloading ~p ...", [Module]),
    code:purge(Module), %% **watch out**
    case code:load_file(Module) of
        {module, Module} ->
            io:format(" ok.~n"),
            case erlang:function_exported(Module, test, 0) of
                true ->
                    io:format(" - Calling ~p:test() ...", [Module]),
                    case catch Module:test() of
                        ok ->
                            io:format(" ok.~n"),
                            reload;
                        Reason ->
                            io:format(" fail: ~p.~n", [Reason]),
                            reload_but_test_failed
                    end;
                false ->
                    reload
            end;
        {error, Reason} ->
            io:format(" fail: ~p.~n", [Reason]),
            error
    end.
```
实际上Erlang Shell中提供的函数的热更函数l(Module)实现就是直接purge，shell提供的函数实现在c.erl文件中，
```
l(Mod) ->
    code:purge(Mod),
    code:load_file(Mod).
```


直接load代码存在杀死进程的危险，所以一种安全的热更机制应该先尝试soft purge，如果成功，则加载代码，失败则放弃更新。
检查代码是否有改变：
```
%% @doc Return a list of beam modules that have changed.
all_changed() ->
    [M || {M, Fn} <- code:all_loaded(), is_list(Fn), is_changed(M)].

%% @spec is_changed(atom()) -> boolean()
%% @doc true if the loaded module is a beam with a vsn attribute
%%      and does not match the on-disk beam file, returns false otherwise.
is_changed(M) ->
    try
        module_vsn(M:module_info()) =/= module_vsn(code:get_object_code(M))
    catch _:_ ->
            false
    end.

%% Internal API

module_vsn({M, Beam, _Fn}) ->
    {ok, {M, Vsn}} = beam_lib:version(Beam),
    Vsn;
module_vsn(L) when is_list(L) ->
    {_, Attrs} = lists:keyfind(attributes, 1, L),
    {_, Vsn} = lists:keyfind(vsn, 1, Attrs),
    Vsn.
```

函数`code:get_object_code(Module)`在代码路径下查找模块 `Module` 的目标代码，如果找到，则返回 `{Module, Binary, Filename}`，否则返回 `error`。

尝试更新代码：
```
case soft_purge(Mod) of
true -> code:load_file(Mod);
false -> error
end
```

## 参考文档

* [Compilation and Code Loading](http://erlang.org/doc/reference_manual/code_loading.html)
* [sync](https://github.com/rustyio/sync)
* reloder
