import {gql} from '@apollo/client';

export const COMPUTE_SIZE = gql`
    mutation JcrStatsComputeSize($path: String, $deleteTemporaryFile: Boolean) {
        jcrStats {
            computeSize(path: $path, deleteTemporaryFile: $deleteTemporaryFile) {
                path
                totalSize
                nodeCount
                flamegraphPath
                flamegraphUrl
            }
        }
    }
`;

export const GET_REPORTS = gql`
    query JcrStatsReports {
        jcrStats {
            reports {
                path
                name
                url
            }
        }
    }
`;

export const GET_SIZE = gql`
    query JcrStatsSize($path: String) {
        jcrStats {
            size(path: $path)
            nodeCount(path: $path)
        }
    }
`;

export const GET_TREE = gql`
    query JcrStatsTree($path: String, $maxDepth: Int) {
        jcrStats {
            tree(path: $path, maxDepth: $maxDepth) {
                name
                size
                children {
                    name
                    size
                    children {
                        name
                        size
                        children {
                            name
                            size
                            children {
                                name
                                size
                                children {
                                    name
                                    size
                                    children {
                                        name
                                        size
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
`;
