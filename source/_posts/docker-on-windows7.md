---
title: docker on windows7
date: 2018-02-27
---

windows 7以前的系统需要通过虚拟机软件运行boot2docker来支持docker,
一般使用VirtualBox来运行boot2docker。boot2docker是一个支持docker的linux环境。

## 安装VirtualBox

windows上安装虚拟机需要先开启cpu的虚拟化支持，否则会有报错：

> Error in driver during machine creation: This computer doesn’t have VT-X/AMD-v enabled.
> Enabling it in the BIOS is mandatory

这是因为电脑虚拟化技术处于被禁用状态，这时就要启动BIOS的虚拟化设置，开启CPU虚拟化支持。
在BIOS中找到CPU的Intel Virtualization Technology选项，选择Enable，保存退出重启即可。

## docker-machine

docker-machine是虚拟机管理程序。我们可以通过它来登陆boot2docker，查看各种虚拟机相关的信息如ip，环境变量等。
在docker客户端输入docker-machine help就能看到帮助。

docker-machine 支持的命令主要有：
* active 打印运行中的虚拟机名称，默认虚拟机为default
* config 打印连接参数
* create 新建虚拟机
* env
* inspect
* ssh 连接虚拟机，docker-machine ssh default 就能连接到默认的虚拟机中。
* ls
* ip 查看boot2docker虚拟机的ip地址，通常是`192.168.99.100`。

虚拟机的默认账号是docker, 密码是tcuser。docker用户是sudoers, 直接执行sudo -i就能切换为root账号。

## 文件夹挂载

跟linux系统不一样，windows下的宿主系统并不是windows本身，而是运行在虚拟机中的boot2docker，
所以在windows下挂载volumn的时候，不能直接把windows下的目录挂载到容器中。

要实现挂载，首先要通过虚拟机系统把windows下的文件夹共享到虚拟机中，默认的虚拟机已经共享了一个文件夹：`c:\Users`，对应的虚拟机中的目录是：`/c/Users`。
所以一般情况下我们是可以把`/c/Users`目录下的文件夹挂载到容器中去。
所以`docker run --rm -it -v /c/Users:/c/ erlang:19.3.3 ls /c/`这条命令能够列出`C:\Users`下面的文件。

但是如果需要支持其他目录，首先要通过VirtualBox把文件夹共享到虚拟机中，
然后才能挂载到容器中。而且使用的时候使用的宿主目录不是windows下的目录，而是虚拟机中的挂载目录。

直接用打开VirtualBox，能看到一个名为default的虚拟机，这个虚拟机就是docker的宿主机，
在这个虚拟机中创建一个共享文件夹，比如把`D:\`挂载到`/d`目录下。
通过`docker-machine restart`重启虚拟机。

`docker run --rm -it -v /d/projects:/apps -w /apps erlang:19.3.3 ./rebar3 as prod tar`

这条命令会把windows下的`D:\projects`目录通过宿主机的`/d/projects`挂载到容器的`/apps`目录下。并且把`/apps`作为容器的工作目录。
这样就能实现通过docker来实现跨平台的编译。顺便说一句，如果只需要支持特定平台的编译，用Jenkins实现目标环境的编译更加方便。


## 端口映射

容器的端口也是映射到宿主机中而不是windows中。这一点也要注意，windows中访问端口的时候要使用宿主机的ip，而不是自身的ip。
宿主机的ip可以通过`docker-machine ip`来查看。一般是`192.168.99.100`.

### 配置加速器

由于DockerHub默认使用的国外的镜像地址，在国内使用的速度感人，需要配置国内的加速。
我本人使用的是[DaoCloud](https://www.daocloud.io/mirror)的加速服务，注册账号以后会分配一个私有的加速地址。
也可以直接用https://www.docker-cn.com/registry-mirror。
修改方法如下：
首先通过`docker-machine ssh <machine-name>`登录虚拟机，默认名字为default.
然后修改/var/lib/boot2docker/profile文件，
`sudo vi /var/lib/boot2docker/profile`
将--registry-mirror=<your accelerate address>添加到EXTRA_ARGS中
最后sudo /etc/init.d/docker restart重启Docker服务就可以了。
