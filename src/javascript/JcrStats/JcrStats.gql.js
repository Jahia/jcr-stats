import {gql} from '@apollo/client';

export const GET_TREE = gql`
    query JcrStatsTree($path: String, $maxDepth: Int) {
        jcrStats {
            tree(path: $path, maxDepth: $maxDepth) {
                name
                size
                nodeCount
                children {
                    name
                    size
                    nodeCount
                    children {
                        name
                        size
                        nodeCount
                        children {
                            name
                            size
                            nodeCount
                            children {
                                name
                                size
                                nodeCount
                                children {
                                    name
                                    size
                                    nodeCount
                                    children {
                                        name
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
