# JCR Statistics
DX module that provides some statistics about the space usage in the JCR
* [How to use it](#how-to-use)
    * [jcr-stats:compute-size](#jcr-stats-compute-size)

## <a name="how-to-use"></a>How to use?

### Basic usage
### Commands
#### <a name="jcr-stats-compute-size"></a>jcr-stats:compute-size
Compute the size recursively. A flamegraph is being generated in the JCR with the path "/sites/systemsite/files/jcr-stats", this flamegraph can also be found in the temporary directory of Tomcat.

**Options:**

Name | alias | Mandatory | Value | Description
 --- | --- | :---: | :---: | ---
 -p | --path | | / | Path to compute
 -d | --delete-temporary-file | | false | Delete temporary file


**Example:**

    jcr-stats:compute-size -p /sites/digital
