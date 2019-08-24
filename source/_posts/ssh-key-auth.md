---
title: ssh key auth
date: 2017-09-30
---

the work flow:
* use ssh-keygen to generate a pair of private and public keys.
* use ssh-copy-id or scp to copy files across local and remote server
* add public key to authorized_keys
* use private key to login

![ssh-key-auth](ssh-key-auth-flow.png)

## server side

```
cd ~
mkdir .ssh
chmod 700 .ssh

cat id_rsa.pub >> authorized_keys

chmod 600 authorized_keys
chmod 600 id_rsa
```

optional:
```
chmod 622 id_rsa.pub
```

## client side

add hostname to hosts file, so we don't have to remember the ip address every time we try to login the server.
although it's not required to do so, we will introduce another way to specify hostname and login user for servers later.

```
cd ~
mkdir .ssh
scp user@remotehost:/home/user/.ssh/id_rsa ./ssh
```

note: copy paste may not working, here we use scp to get the private key, and ssh-copy-id is recommended.

try:

```
ssh user@remotehost
```

if the key pair is generated on the client side, then:
```
centos6: ssh-copy-id -i ~/.ssh/id_rsa.pub "zsy@10.1.0.3 -p 22222"
centos7: ssh-copy-id -i ~/.ssh/id_rsa.pub zsy@10.1.0.3 -p 22222
or
cat ~/.ssh/id_rsa.pub | ssh -p 22 zsy@10.1.0.3 "umask 077;mkdir -p ~/.ssh;cat - >> ~/.ssh/authorized_keys"
```

## config

add these lines to file `~/.ssh/config`, as before, `chmod 600 ~/.ssh/config`.

```ssh_config
host shortname1
    hostname server_ip_1
    user user1
    port 22
    ##IdentityFile somefile

host shortname2
    hostname server_ip_2
    user user2
    port 22
```

then you can type `ssh shortname1` or `ssh shortname2` to login.

## more about config

some enties:

* Host: Defines for which host or hosts the configuration section applies. The section ends with a new Host section or the end of the file. A single * as a pattern can be used to provide global defaults for all hosts.
* HostName : Specifies the real host name to log into. Numeric IP addresses are also permitted.
* User : Defines the username for the SSH connection.
* IdentityFile : Specifies a file from which the user’s DSA, ECDSA or DSA authentication identity is read. The default is ~/.ssh/identity for protocol version 1, and ~/.ssh/id_dsa, ~/.ssh/id_ecdsa and ~/.ssh/id_rsa for protocol version 2.
* ProxyCommand : Specifies the command to use to connect to the server. The command string extends to the end of the line, and is executed with the user’s shell. In the command string, any occurrence of %h will be substituted by the host name to connect, %p by the port, and %r by the remote user name. The command can be basically anything, and should read from its standard input and write to its standard output. This directive is useful in conjunction with nc(1) and its proxy support. For example, the following directive would connect via an HTTP proxy at 192.1.0.253: `ProxyCommand /usr/bin/nc -X connect -x 192.1.0.253:3128 %h %p`
* LocalForward : Specifies that a TCP port on the local machine be forwarded over the secure channel to the specified host and port from the remote machine. The first argument must be [bind_address:]port and the second argument must be host:hostport.
* Port : Specifies the port number to connect on the remote host.
* Protocol : Specifies the protocol versions ssh(1) should support in order of preference. The possible values are 1 and 2.
* ServerAliveInterval : Sets a timeout interval in seconds after which if no data has been received from the server, ssh(1) will send a message through the encrypted channel to request a response from the server.
* ServerAliveCountMax : Sets the number of server alive messages which may be sent without ssh(1) receiving any messages back from the server. If this threshold is reached while server alive messages are being sent, ssh will disconnect from the server, terminating the session.

a more detailed example:

```conf
### default for all ##
Host *
     ForwardAgent no
     ForwardX11 no
     ForwardX11Trusted yes
     User nixcraft
     Port 22
     Protocol 2
     ServerAliveInterval 60
     ServerAliveCountMax 30

## override as per host ##
Host server1
     HostName server1.cyberciti.biz
     User nixcraft
     Port 4242
     IdentityFile /nfs/shared/users/nixcraft/keys/server1/id_rsa

## Home nas server ##
Host nas01
     HostName 192.168.1.100
     User root
     IdentityFile ~/.ssh/nas01.key

## Login AWS Cloud ##
Host aws.apache
     HostName 1.2.3.4
     User wwwdata
     IdentityFile ~/.ssh/aws.apache.key

## Login to internal lan server at 192.168.0.251 via our public uk office ssh based gateway using ##
## $ ssh uk.gw.lan ##
Host uk.gw.lan uk.lan
     HostName 192.168.0.251
     User nixcraft
     ProxyCommand  ssh nixcraft@gateway.uk.cyberciti.biz nc %h %p 2> /dev/null

## Our Us Proxy Server ##
## Forward all local port 3128 traffic to port 3128 on the remote vps1.cyberciti.biz server ##
## $ ssh -f -N  proxyus ##
Host proxyus
    HostName vps1.cyberciti.biz
    User breakfree
    IdentityFile ~/.ssh/vps1.cyberciti.biz.key
    LocalForward 3128 127.0.0.1:3128
```

## debug

when unexpected happened, use option `-vvv` to output debug message.

## reference

* https://www.digitalocean.com/community/tutorials/how-to-configure-ssh-key-based-authentication-on-a-linux-server
* https://www.cyberciti.biz/faq/create-ssh-config-file-on-linux-unix/
* http://nerderati.com/2011/03/17/simplify-your-life-with-an-ssh-config-file/
* https://linux.die.net/man/5/ssh_config
* http://www.zsythink.net/archives/2375
* man ssh_config
