---
title: 数据库事务
date: 2017-07-11
---

事务需要满足ACID特征。Mysql的innodb引擎支持事务。

* 原子性，Atomicity, 一个事务是不可分割的整体，要么全部成功(committed)，要么全部失败(rolled back)，不存在部分成功。
* 一致性，Consistency，数据总是从一致性的状态转移到另一个一致性的状态，总是处于有意义的状态。比如转账，A的钱减少，B的钱增加，总和是不变的。
* 隔离性，Isolation，主要解决多个事务**并发读写**的问题，一个事务未提交，那么它对数据的修改对外是不可见的。
* 持久性，Durability，一个事务一旦提交，对数据的影响的永久性的，就算断电，系统崩溃也是如此。

四个性质最根本的是一致性，其他三个性质都是服务于一致性的。

## 隔离级别

当多个进程的事务同时读写数据时，就会出现一些问题。

* 脏读，dirty read，一个事务可以读到其他事务尚未提交的修改。尚未提交意味着可能回滚，那么该事务读到的就是无效的数据。
* 不可重复读，unrepeatable read，同一个事务范围内多次查询却返回了不同的数据，这是因为在查询间隙，数据被另外的事务修改了(update, delete)。
* 虚读，幻读，phantom read，同一个事务范围内，相同的操作两次读取的记录数不一样，比如多出来一行(add)。跟不可重复读的对象不一样，幻读针对的是一批数据，而后者指的是同一个数据。

innodb通过不同的锁策略支持四个级别的隔离性。

* Read uncommitted，最低级别，任何情况都无法保证。
* Read committed，可避免脏读。
* Repeatable read，在Sql标准中，RR级别可避免脏读和不可重复读，但是还存在幻读。RR是innodb的默认级别，innodb的RR解决了幻读的问题。
* Serializable，最高级别，可避免脏读，不可重复读，幻读的发生，效率最低，一般通过锁表来实现。

| 隔离级别     | 脏读 | 不可重复读 | 幻读                                       |
|--------------|------|------------|--------------------------------------------|
| 未提交读     | Yes  | Yes        | Yes                                        |
| 已提交读(RC) | No   | Yes        | Yes                                        |
| 可重复读(RR) | No   | No         | Yes(注：Innodb的RR级别通过gap锁解决了幻读) |
| 可串行化     | No   | No         | No                                         |

mysql中查看隔离级别：

```mysql
mysql> select @@global.tx_isolation, @@tx_isolation;
+-----------------------+----------------+
| @@global.tx_isolation | @@tx_isolation |
+-----------------------+----------------+
| READ-COMMITTED        | READ-COMMITTED |
+-----------------------+----------------+
1 row in set (0.00 sec)
```

innodb可以通过下面的命令设置隔离级别，注意带global, session或者都不带效果是不一样的。

```mysql
set [global | session] transaction isolation level [read uncommitted |read committed |repeatable read | serializable];
```

* With the GLOBAL keyword, the statement applies globally for all subsequent sessions. Existing sessions are unaffected.
* With the SESSION keyword, the statement applies to all subsequent transactions performed within the current session.
* Without any SESSION or GLOBAL keyword, the statement applies to the next (not started) transaction performed within the current session. Subsequent transactions revert to using the SESSION isolation level.

在事务内部无法修改下一个事务的隔离级别：

```mysql
mysql> begin;
Query OK, 0 rows affected (0.00 sec)
mysql> set transaction isolation level serializable;
ERROR 1568 (25001): Transaction isolation level can't be changed while a transaction is in progress
mysql> commit;
Query OK, 0 rows affected (0.00 sec)
mysql> set transaction isolation level serializable;
Query OK, 0 rows affected (0.00 sec)
```

或者

```mysql
set tx_isolation = 'read-uncommitted';
set tx_isolation = 'read-committed';
set tx_isolation = 'repeatable-read';
set tx_isolation = 'serializable';
```

## 2PL: Two-Phase Locking

传统RDBMS加锁的一个原则，二阶段锁。锁操作分为两个阶段：加锁阶段和解锁阶段，并且保证加锁阶段和解锁阶段不相交。

* 加锁阶段：只加锁，不放锁。
* 解锁阶段：只放锁，不加锁。

## 行锁

如果一个条件无法通过索引快速过滤，存储引擎层面就会将所有记录加锁后返回，再由MySQL Server层进行过滤。
但在实际使用过程当中，MySQL做了一些改进，在MySQL Server过滤条件，发现不满足后，会调用unlock_row方法，把不满足条件的记录释放锁 (违背了二段锁协议的约束)。
这样做，保证了最后只会持有满足条件记录上的锁，但是每条记录的加锁操作还是不能省略的。可见即使是MySQL，为了效率也是会违反规范的。

这种情况同样适用于MySQL的默认隔离级别RR。所以对一个数据量很大的表做批量修改的时候，如果无法使用相应的索引，
MySQL Server过滤数据的的时候特别慢，就会出现虽然没有修改某些行的数据，但是它们还是被锁住了的现象。

## MVCC多版本并发控制

与MVCC相对的，是基于锁的并发控制，Lock-Based Concurrency Control，最大的好处是，读不加锁，读写不冲突。
InnoDB中，每行数据后添加两个额外的隐藏的值来实现MVCC。一个记录这行数据何时被创建，另外一个记录这行数据何时过期（或者被删除）。
在实际操作中，存储的并不是时间，而是事务的版本号。每开启一个新事务，事务的版本号就会递增。
在RR事务隔离级别下：

* select时，读取创建版本号<=当前事务版本号，删除版本号为空或者大于当前事务版本号的记录。
* insert时，保存当前事务版本号为行的创建版本号。
* delete时，保存当前事务版本号位行的删除版本号。
* update时，插入一条新记录，保存当前事务版本号为行创建版本号，同时保存当前事务版本号为原来行的删除版本号。

通过MVCC，每行记录都需要额外的存储空间，更多的行检查工作和额外的维护工作，但是可以减少锁的使用。大多数操作都不用加锁。
读数据操作很简单，性能很好，并且也能保证只会读取到符合标准的行，也只锁住必要行。

Mysql的RR级别是解决了幻读的问题的。

### 快照读 snapshot read

简单的select操作，属于快照读，读取记录的可见版本，不用加锁。

* select * from table where ?;

### 当前读 current read

特殊的读操作，以及插入，更新，删除操作，属于当前读。

* select * from table where ? lock in share mode;
* select * from table where ? for update;
* insert into table values (...);
* update table set ? where ?;
* delete from table where ?;

读取的是记录的最新版本，并且当前读返回的记录，都会加上锁，保证其他事务不会再并发修改这条记录。
除了第一条语句对读取记录加S锁（共享锁）外，其他的操作都加的是X锁（排它锁）。

### GAP间隙锁

幻读无法通过行锁来解决。
行锁防止别的事务修改或删除，GAP锁防止别的事务新增，行锁和GAP锁结合形成的的Next-Key锁共同解决了RR级别在写数据时的幻读问题。

有索引的时候，Gap锁很多时候会锁住不需要锁的区间。
没有索引的时候，Gap锁会锁住所有记录，但是innodb不会主动升级表锁。

## Serializable

不区分快照读与当前读，所有读操作均为当前读。
读加共享锁(S锁)，写加排它锁(X锁)，读写互斥。使用悲观锁的理论，实现简单，数据更加安全，但是并发能力非常差。如果你的业务并发特别少或者没有并发，
同时有要求数据及时可靠的话，可以使用这种模式。这个级别下select也是会加锁的。

## 死锁

死锁的本质是两个以上的session对资源的加锁顺序不一致。解决死锁的关键在于让不同的session加锁有次序。

## 参考文档

* [Innodb中的事务隔离级别和锁的关系](https://tech.meituan.com/innodb-lock.html)
* [数据库事务的四大特性以及事务的隔离级别](http://www.cnblogs.com/fjdingsd/p/5273008.html)
* [SET TRANSACTION Syntax](https://dev.mysql.com/doc/refman/5.7/en/set-transaction.html)
* [Transaction Isolation Levels](https://dev.mysql.com/doc/refman/5.7/en/innodb-transaction-isolation-levels.html)
* http://hedengcheng.com/?p=771
