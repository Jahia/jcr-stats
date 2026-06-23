import {gql} from '@apollo/client';

export const COMPUTE = gql`
    mutation JcrStatsCompute($path: String) {
        jcrStats {
            compute(path: $path)
        }
    }
`;

export const CANCEL = gql`
    mutation JcrStatsCancel {
        jcrStats {
            cancel
        }
    }
`;

export const GET_STATUS = gql`
    query JcrStatsStatus {
        jcrStats {
            status {
                running
                path
                error
                hasResult
                startedAt
                elapsedMs
                visitedCount
                cancelled
            }
        }
    }
`;

export const GET_RESULT = gql`
    query JcrStatsResult($maxDepth: Int) {
        jcrStats {
            result(maxDepth: $maxDepth) {
                name
                path
                size
                nodeCount
                children {
                    name
                    path
                    size
                    nodeCount
                    children {
                        name
                        path
                        size
                        nodeCount
                        children {
                            name
                            path
                            size
                            nodeCount
                            children {
                                name
                                path
                                size
                                nodeCount
                                children {
                                    name
                                    path
                                    size
                                    nodeCount
                                    children {
                                        name
                                        path
                                        size
                                        nodeCount
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
